// @jorgemartins72/cliente-session/server
//
// Sessão no servidor para Nuxt/Nitro (h3 1.x). Os tokens e a X-API-Key ficam só no servidor:
// o navegador recebe apenas um cookie selado (HttpOnly) e os dados públicos do usuário.
import {
  createError,
  defineEventHandler,
  getHeader,
  getRequestURL,
  readBody,
  readRawBody,
  setResponseStatus,
  useSession,
  type H3Event,
} from 'h3'
import { CSRF_HEADER, CSRF_VALUE, SAFE_METHODS } from './shared'

export type RouteAuth = 'required' | 'optional' | 'none'

/**
 * Regra da lista de rotas permitidas. O que não casar com nenhuma regra responde 404.
 * `path` é relativo à API (sem o prefixo do Nuxt). Em cada segmento, `*` casa um segmento
 * qualquer; `**` no final casa o restante.
 */
export interface RouteRule {
  methods: string | string[]
  path: string
  /** `required` (padrão): exige sessão. `optional`: usa o token se houver. `none`: nunca envia token. */
  auth?: RouteAuth
  /**
   * A API responde com `access_token`/`refresh_token` (ex.: definir a senha faz login automático).
   * O servidor guarda os tokens no cookie selado e devolve ao navegador só `{ user }`.
   * Use com `auth: 'none'`.
   */
  startsSession?: boolean
}

export interface SessionServerOptions {
  /** URL base da API (ex.: https://api.esporteflow.com), sem barra no final. */
  apiBase: string
  /** Chave do tenant (`X-API-Key`). Nunca vai ao navegador. */
  apiKey: string
  /** Senha do cookie selado. Mínimo de 32 caracteres. */
  password: string
  /** Lista de rotas permitidas no proxy (deny by default). */
  routes: RouteRule[]
  /** Slug da organização enviado no login (`organizacao`). Opcional com chave de tenant. */
  organization?: string
  cookieName?: string
  /** Duração do cookie em segundos. Padrão: 36000 (10 h, igual ao refresh token). */
  maxAge?: number
  /** Flag `Secure` do cookie. Padrão: true. Use false só em http://localhost (Safari não aceita Secure). */
  secure?: boolean
  sameSite?: 'lax' | 'strict'
  /** Prefixo do proxy no Nuxt. Padrão: `/api`. */
  prefix?: string
  /** Segundos de folga antes do vencimento do access token para renová-lo. Padrão: 30. */
  refreshSkew?: number
  /** Substitui o `fetch` global (testes). */
  fetch?: typeof fetch
}

export type SessionServerConfig = SessionServerOptions | ((event: H3Event) => SessionServerOptions)

interface SessionData {
  access_token?: string
  refresh_token?: string
  user?: unknown
}

// Rotas públicas (só com X-API-Key) seguras para o proxy. Não inclui `POST /auth` nem
// `/auth/refresh`: tokens nunca devem chegar ao JavaScript do navegador. As rotas `senha`
// fazem login automático na API, então usam `startsSession` (tokens vão para o cookie).
export const publicAuthRoutes: RouteRule[] = [
  { methods: 'GET', path: '/auth/slug/*', auth: 'none' },
  { methods: 'POST', path: '/auth/register', auth: 'none' },
  { methods: 'POST', path: '/auth/primeiro-acesso/solicitar', auth: 'none' },
  { methods: 'POST', path: '/auth/primeiro-acesso/verificar', auth: 'none' },
  { methods: 'POST', path: '/auth/primeiro-acesso/senha', auth: 'none', startsSession: true },
  { methods: 'POST', path: '/auth/forgot/solicitar', auth: 'none' },
  { methods: 'POST', path: '/auth/forgot/verificar', auth: 'none' },
  { methods: 'POST', path: '/auth/forgot/senha', auth: 'none', startsSession: true },
]

const MAX_COOKIE_ESTIMATE = 3800

// ---------- utilidades puras (exportadas para teste) ----------

/** Lê o `exp` (segundos) de um JWT sem validar a assinatura. `undefined` se não for um JWT. */
export function jwtExp(token: string | undefined): number | undefined {
  if (!token) return undefined
  const part = token.split('.')[1]
  if (!part) return undefined
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    )
    const exp = JSON.parse(json).exp
    return typeof exp === 'number' ? exp : undefined
  } catch {
    return undefined
  }
}

function expiresWithin(token: string | undefined, seconds: number): boolean {
  const exp = jwtExp(token)
  return exp !== undefined && exp * 1000 <= Date.now() + seconds * 1000
}

/**
 * Normaliza o caminho recebido e rejeita o que pode escapar da lista de rotas:
 * segmentos `.`/`..` (inclusive codificados), barras codificadas, `\` e caracteres de controle.
 */
export function normalizePath(path: string): string | null {
  if (!path.startsWith('/')) return null
  if (/%2f|%5c/i.test(path) || path.includes('\\')) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return null
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(decoded)) return null
  const segments = decoded.split('/').slice(1)
  if (segments.some((s) => s === '.' || s === '..')) return null
  if (segments.slice(0, -1).some((s) => s === '')) return null // "//"
  return path
}

function matchPattern(pattern: string, path: string): boolean {
  const p = pattern.split('/').filter(Boolean)
  const s = path.split('/').filter(Boolean)
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '**') return i === p.length - 1
    if (i >= s.length) return false
    if (p[i] !== '*' && p[i] !== s[i]) return false
  }
  return p.length === s.length
}

export function matchRoute(routes: RouteRule[], method: string, path: string): RouteRule | undefined {
  const m = method.toUpperCase()
  return routes.find((r) => {
    const methods = (Array.isArray(r.methods) ? r.methods : [r.methods]).map((x) => x.toUpperCase())
    return methods.includes(m) && matchPattern(r.path, path)
  })
}

// ---------- servidor ----------

export function createSessionServer(config: SessionServerConfig) {
  const resolve = (event: H3Event): Required<Omit<SessionServerOptions, 'organization' | 'fetch'>> &
    Pick<SessionServerOptions, 'organization' | 'fetch'> => {
    const o = typeof config === 'function' ? config(event) : config
    if (!o.password || o.password.length < 32) {
      throw createError({ statusCode: 500, statusMessage: 'Senha de sessão ausente ou menor que 32 caracteres.' })
    }
    if (!o.apiBase || !o.apiKey) {
      throw createError({ statusCode: 500, statusMessage: 'apiBase e apiKey são obrigatórios.' })
    }
    return {
      cookieName: 'tenant_session',
      maxAge: 36000,
      secure: true,
      sameSite: 'lax',
      prefix: '/api',
      refreshSkew: 30,
      ...o,
      apiBase: o.apiBase.replace(/\/+$/, ''),
    }
  }

  type Opts = ReturnType<typeof resolve>

  const openSession = (o: Opts, event: H3Event) =>
    useSession<SessionData>(event, {
      password: o.password,
      name: o.cookieName,
      maxAge: o.maxAge,
      cookie: { httpOnly: true, secure: o.secure, sameSite: o.sameSite, path: '/' },
    })

  type Session = Awaited<ReturnType<typeof openSession>>

  const callApi = (o: Opts, path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers)
    headers.set('x-api-key', o.apiKey) // sempre a do servidor
    if (!headers.has('accept')) headers.set('accept', 'application/json')
    return (o.fetch ?? fetch)(`${o.apiBase}${path}`, { ...init, headers })
  }

  const readPayload = async (res: Response): Promise<unknown> => {
    const text = await res.text()
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      return { detail: text }
    }
  }

  // Devolve o erro da API como veio, para o front continuar lendo `err.data.detail.code`.
  const forward = (event: H3Event, status: number, payload: unknown) => {
    setResponseStatus(event, status)
    return payload ?? { detail: 'Erro na API.' }
  }

  const fail = (event: H3Event, status: number, code: string, message: string) =>
    forward(event, status, { detail: { code, message } })

  const requireCsrf = (event: H3Event) => {
    if (getHeader(event, CSRF_HEADER) !== CSRF_VALUE) {
      throw createError({ statusCode: 403, statusMessage: 'Requisição sem o header de proteção CSRF.' })
    }
  }

  const store = async (session: Session, data: SessionData) => {
    // O cookie selado cresce ~1,4x e os navegadores descartam cookies acima de ~4 KB.
    if (JSON.stringify(data).length * 1.4 + 150 > MAX_COOKIE_ESTIMATE) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Dados de sessão grandes demais para o cookie (reduza o conteúdo de `user`).',
      })
    }
    await session.update(data)
  }

  /** Renova os tokens. Devolve o novo access token ou `undefined` (e limpa a sessão se a API recusar). */
  const refresh = async (o: Opts, session: Session): Promise<string | undefined> => {
    const rt = session.data.refresh_token
    if (!rt || expiresWithin(rt, 0)) {
      await session.clear()
      return undefined
    }
    const res = await callApi(o, '/auth/refresh', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    })
    if (!res.ok) {
      // só encerra a sessão se a API recusou o token; 5xx pode ser passageiro
      if (res.status === 401 || res.status === 403) await session.clear()
      return undefined
    }
    const p = (await readPayload(res)) as Partial<SessionData> | null
    if (!p?.access_token) return undefined
    await store(session, {
      access_token: p.access_token,
      refresh_token: p.refresh_token ?? rt,
      user: p.user ?? session.data.user,
    })
    return p.access_token
  }

  // POST /api/auth/login  { email, password }  ->  { user }
  const login = defineEventHandler(async (event) => {
    const o = resolve(event)
    requireCsrf(event)
    const body = (await readBody(event).catch(() => null)) as { email?: unknown; password?: unknown } | null
    if (typeof body?.email !== 'string' || typeof body?.password !== 'string') {
      return fail(event, 422, 'FIELDS_REQUIRED', 'email e password são obrigatórios.')
    }
    const res = await callApi(o, '/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(o.organization ? { organizacao: o.organization } : {}),
        email: body.email,
        password: body.password,
      }),
    })
    const payload = await readPayload(res)
    if (!res.ok) return forward(event, res.status, payload)

    const p = payload as Partial<SessionData> | null
    if (!p?.access_token || !p?.refresh_token) {
      return fail(event, 502, 'BAD_UPSTREAM', 'Resposta de login inesperada da API.')
    }
    const session = await openSession(o, event)
    await store(session, { access_token: p.access_token, refresh_token: p.refresh_token, user: p.user })
    return { user: p.user ?? null }
  })

  // GET /api/auth/session  ->  { authenticated, user }
  const sessionInfo = defineEventHandler(async (event) => {
    const o = resolve(event)
    const session = await openSession(o, event)
    const { refresh_token, access_token, user } = session.data
    if (!refresh_token || expiresWithin(refresh_token, 0)) {
      if (refresh_token || access_token) await session.clear()
      return { authenticated: false, user: null }
    }
    return { authenticated: true, user: user ?? null }
  })

  // POST /api/auth/logout
  const logout = defineEventHandler(async (event) => {
    const o = resolve(event)
    requireCsrf(event)
    await (await openSession(o, event)).clear()
    return { ok: true }
  })

  // /api/** : repassa à API só o que estiver na lista de rotas
  const proxy = defineEventHandler(async (event) => {
    const o = resolve(event)
    const notFound = () => fail(event, 404, 'NOT_FOUND', 'Rota não encontrada')

    const method = event.method.toUpperCase()
    const url = getRequestURL(event)
    if (!url.pathname.startsWith(o.prefix + '/')) return notFound()
    const path = normalizePath(url.pathname.slice(o.prefix.length))
    const rule = path ? matchRoute(o.routes, method, path) : undefined
    if (!path || !rule) return notFound()

    const writes = !SAFE_METHODS.includes(method)
    if (writes) requireCsrf(event)

    const auth = rule.auth ?? 'required'
    const session = auth === 'none' ? undefined : await openSession(o, event)
    let token = session?.data.access_token
    let refreshed = false

    if (session && token && expiresWithin(token, o.refreshSkew)) {
      token = await refresh(o, session)
      refreshed = true
    }
    if (auth === 'required' && !token) {
      return fail(event, 401, 'SESSION_REQUIRED', 'Sessão ausente ou expirada.')
    }

    const raw = writes ? await readRawBody(event, false) : undefined
    const send = (bearer: string | undefined) => {
      const headers: Record<string, string> = {}
      for (const name of ['content-type', 'accept', 'accept-language']) {
        const v = getHeader(event, name)
        if (v) headers[name] = v
      }
      // Authorization e X-API-Key do navegador são descartados: só valem os do servidor.
      if (bearer) headers.authorization = `Bearer ${bearer}`
      return callApi(o, path + url.search, { method, headers, body: raw as BodyInit | undefined })
    }

    let res = await send(token)
    if (res.status === 401 && session && !refreshed && session.data.refresh_token) {
      const detail = ((await res.clone().json().catch(() => null)) as { detail?: { code?: string } } | null)?.detail
      const apiKeyProblem = typeof detail === 'object' && String(detail?.code ?? '').startsWith('API_KEY')
      if (!apiKeyProblem) {
        const renewed = await refresh(o, session)
        if (renewed) res = await send(renewed)
      }
    }

    if (rule.startsSession && res.ok) {
      const p = (await readPayload(res)) as Partial<SessionData> | null
      if (!p?.access_token || !p?.refresh_token) {
        return fail(event, 502, 'BAD_UPSTREAM', 'Resposta inesperada da API.')
      }
      const started = await openSession(o, event)
      await store(started, { access_token: p.access_token, refresh_token: p.refresh_token, user: p.user })
      // essas rotas não devolvem o usuário: busca pelo refresh (que também o devolve)
      if (p.user === undefined) await refresh(o, started)
      return { user: started.data.user ?? null }
    }

    // Só o status e o tipo do conteúdo voltam; cookies e demais headers da API são descartados.
    const out = new Headers()
    const type = res.headers.get('content-type')
    if (type) out.set('content-type', type)
    return new Response(res.body, { status: res.status, headers: out })
  })

  return { login, session: sessionInfo, logout, proxy }
}
