import { createApp, createRouter, toWebHandler } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSessionServer,
  jwtExp,
  matchRoute,
  normalizePath,
  publicAuthRoutes,
  type RouteRule,
} from '../src/server'

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (expInSeconds: number) => `h.${b64({ exp: Math.floor(Date.now() / 1000) + expInSeconds })}.s`

const ROUTES: RouteRule[] = [
  ...publicAuthRoutes,
  { methods: ['GET', 'POST'], path: '/profiles' },
  { methods: ['GET', 'PATCH'], path: '/profiles/*' },
  { methods: 'GET', path: '/etapas/**', auth: 'none' },
]

interface Call {
  path: string
  method: string
  headers: Headers
  body: string
}

let calls: Call[]
let respond: (path: string, call: Call) => Response | Promise<Response>

const upstream = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
  const u = new URL(String(url))
  const call: Call = {
    path: u.pathname + u.search,
    method: init?.method ?? 'GET',
    headers: new Headers(init?.headers),
    body: init?.body ? Buffer.from(init.body as Uint8Array).toString() : '',
  }
  calls.push(call)
  return respond(call.path, call)
}) as unknown as typeof fetch

function makeHandler(extra: Record<string, unknown> = {}) {
  const s = createSessionServer({
    apiBase: 'http://api.test/',
    apiKey: 'CHAVE-DO-SERVIDOR',
    password: 'p'.repeat(40),
    routes: ROUTES,
    organization: 'jamar',
    secure: false,
    fetch: upstream,
    ...extra,
  })
  const router = createRouter()
  router.post('/api/auth/login', s.login)
  router.get('/api/auth/session', s.session)
  router.post('/api/auth/reload', s.reload)
  router.post('/api/auth/logout', s.logout)
  router.use('/api/**', s.proxy)
  return toWebHandler(createApp().use(router))
}

let handler: ReturnType<typeof makeHandler>

async function call(
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown; cookie?: string; csrf?: boolean } = {},
) {
  const method = init.method ?? 'GET'
  const headers: Record<string, string> = { ...init.headers }
  if (method !== 'GET' && init.csrf !== false) headers['x-requested-with'] = 'cliente-session'
  if (init.cookie) headers.cookie = init.cookie
  let body: string | undefined
  if (init.body !== undefined) {
    body = JSON.stringify(init.body)
    headers['content-type'] = 'application/json'
  }
  return handler(new Request(`http://site.test${path}`, { method, headers, body }))
}

const cookieOf = (res: Response) => {
  const set = res.headers.getSetCookie().find((c) => c.startsWith('tenant_session='))
  return set ? set.split(';')[0] : undefined
}

async function loginAs(access = jwt(1800), refresh = jwt(36000)) {
  respond = () => Response.json({ access_token: access, refresh_token: refresh, user: { name: 'Ana', roles: ['atleta'] } })
  const res = await call('/api/auth/login', { method: 'POST', body: { email: 'a@a.com', password: 'segredo123' } })
  calls = []
  return cookieOf(res)!
}

beforeEach(() => {
  calls = []
  respond = () => Response.json({})
  handler = makeHandler()
})

describe('utilidades', () => {
  it('lê o exp do JWT e ignora o que não é JWT', () => {
    expect(jwtExp(`h.${b64({ exp: 123 })}.s`)).toBe(123)
    expect(jwtExp('abc')).toBeUndefined()
    expect(jwtExp(undefined)).toBeUndefined()
  })

  it('rejeita caminhos que escapam da lista', () => {
    expect(normalizePath('/profiles/1')).toBe('/profiles/1')
    for (const bad of [
      '/profiles/../api-keys',
      '/profiles/%2e%2e/api-keys',
      '/profiles/%2E%2E/api-keys',
      '/profiles%2f..%2fapi-keys',
      '/profiles\\..\\api-keys',
      '/profiles//1',
      '/profiles/%00',
      '/profiles/%E0%A4%A',
    ]) {
      expect(normalizePath(bad), bad).toBeNull()
    }
  })

  it('casa método e padrão', () => {
    expect(matchRoute(ROUTES, 'get', '/profiles/1')).toBeTruthy()
    expect(matchRoute(ROUTES, 'DELETE', '/profiles/1')).toBeUndefined()
    expect(matchRoute(ROUTES, 'GET', '/profiles/1/x')).toBeUndefined()
    expect(matchRoute(ROUTES, 'GET', '/etapas/2026/praia')).toBeTruthy()
    expect(matchRoute(ROUTES, 'POST', '/auth')).toBeUndefined()
    expect(matchRoute(ROUTES, 'POST', '/auth/refresh')).toBeUndefined()
  })
})

describe('login', () => {
  it('grava cookie HttpOnly e devolve só o usuário', async () => {
    const access = jwt(1800)
    respond = () => Response.json({ access_token: access, refresh_token: jwt(36000), user: { name: 'Ana' } })
    const res = await call('/api/auth/login', { method: 'POST', body: { email: 'a@a.com', password: 'segredo123' } })

    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ user: { name: 'Ana' } })
    expect(text).not.toContain(access)

    const set = res.headers.getSetCookie().find((c) => c.startsWith('tenant_session='))!
    expect(set).toMatch(/HttpOnly/i)
    expect(set).toMatch(/SameSite=Lax/i)
    expect(set).not.toContain(access) // selado, não legível

    expect(calls[0].path).toBe('/auth')
    expect(calls[0].headers.get('x-api-key')).toBe('CHAVE-DO-SERVIDOR')
    expect(JSON.parse(calls[0].body)).toEqual({ organizacao: 'jamar', email: 'a@a.com', password: 'segredo123' })
  })

  it('repassa o erro da API como veio (err.data.detail.code)', async () => {
    respond = () => Response.json({ detail: { code: 'PASSWORD_NOT_SET', message: 'x' } }, { status: 401 })
    const res = await call('/api/auth/login', { method: 'POST', body: { email: 'a@a.com', password: 'segredo123' } })
    expect(res.status).toBe(401)
    expect((await res.json()).detail.code).toBe('PASSWORD_NOT_SET')
    expect(cookieOf(res)).toBeUndefined()
  })

  it('exige o header CSRF e os campos', async () => {
    expect((await call('/api/auth/login', { method: 'POST', body: {}, csrf: false })).status).toBe(403)
    expect((await call('/api/auth/login', { method: 'POST', body: { email: 'a@a.com' } })).status).toBe(422)
    expect(calls).toHaveLength(0)
  })

  it('recusa cookie grande demais em vez de perdê-lo no navegador', async () => {
    respond = () => Response.json({ access_token: jwt(60), refresh_token: jwt(60), user: { permissions: 'x'.repeat(4000) } })
    const res = await call('/api/auth/login', { method: 'POST', body: { email: 'a@a.com', password: 'segredo123' } })
    expect(res.status).toBe(500)
  })

  it('falha com senha de sessão curta', async () => {
    handler = makeHandler({ password: 'curta' })
    const res = await call('/api/auth/login', { method: 'POST', body: { email: 'a@a.com', password: 'segredo123' } })
    expect(res.status).toBe(500)
  })
})

describe('sessão e logout', () => {
  it('session: anônimo sem cookie, autenticado com cookie', async () => {
    expect(await (await call('/api/auth/session')).json()).toEqual({ authenticated: false, user: null })
    const cookie = await loginAs()
    expect(await (await call('/api/auth/session', { cookie })).json()).toEqual({
      authenticated: true,
      user: { name: 'Ana', roles: ['atleta'] },
    })
  })

  it('session: refresh token vencido encerra a sessão', async () => {
    const cookie = await loginAs(jwt(-60), jwt(-10))
    const res = await call('/api/auth/session', { cookie })
    expect(await res.json()).toEqual({ authenticated: false, user: null })
  })

  it('logout apaga o cookie e exige CSRF', async () => {
    const cookie = await loginAs()
    expect((await call('/api/auth/logout', { method: 'POST', cookie, csrf: false })).status).toBe(403)
    const res = await call('/api/auth/logout', { method: 'POST', cookie })
    expect(res.status).toBe(200)
    const after = cookieOf(res)
    const info = await call('/api/auth/session', { cookie: after })
    expect((await info.json()).authenticated).toBe(false)
  })
})

describe('reload', () => {
  it('renova o usuário do cookie com o que a API devolve no refresh', async () => {
    const cookie = await loginAs()
    respond = () =>
      Response.json({ access_token: jwt(1800), refresh_token: jwt(36000), user: { name: 'Ana Maria', roles: ['atleta'] } })
    const res = await call('/api/auth/reload', { method: 'POST', cookie })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ user: { name: 'Ana Maria', roles: ['atleta'] } })
    expect(calls.map((c) => c.path)).toEqual(['/auth/refresh'])
    const next = cookieOf(res)!
    expect((await (await call('/api/auth/session', { cookie: next })).json()).user.name).toBe('Ana Maria')
  })

  it('exige CSRF e sessão', async () => {
    const cookie = await loginAs()
    expect((await call('/api/auth/reload', { method: 'POST', cookie, csrf: false })).status).toBe(403)
    const anon = await call('/api/auth/reload', { method: 'POST' })
    expect(anon.status).toBe(401)
    expect((await anon.json()).detail.code).toBe('SESSION_REQUIRED')
    expect(calls).toEqual([])
  })

  it('refresh recusado encerra a sessão (401)', async () => {
    const cookie = await loginAs()
    respond = () => Response.json({ detail: 'x' }, { status: 401 })
    const res = await call('/api/auth/reload', { method: 'POST', cookie })
    expect(res.status).toBe(401)
    const info = await call('/api/auth/session', { cookie: cookieOf(res) })
    expect((await info.json()).authenticated).toBe(false)
  })

  it('erro 5xx na API mantém a sessão e responde 502', async () => {
    const cookie = await loginAs()
    respond = () => new Response('x', { status: 503 })
    const res = await call('/api/auth/reload', { method: 'POST', cookie })
    expect(res.status).toBe(502)
    const info = await call('/api/auth/session', { cookie })
    expect((await info.json()).authenticated).toBe(true)
  })
})

describe('proxy', () => {
  it('envia o token e a chave do servidor e descarta os do navegador', async () => {
    const access = jwt(1800)
    const cookie = await loginAs(access)
    respond = () => Response.json([{ id: 1 }])
    const res = await call('/api/profiles?page=2', {
      cookie,
      headers: { authorization: 'Bearer ROUBADO', 'x-api-key': 'OUTRA-CHAVE' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: 1 }])
    expect(calls[0].path).toBe('/profiles?page=2')
    expect(calls[0].headers.get('authorization')).toBe(`Bearer ${access}`)
    expect(calls[0].headers.get('x-api-key')).toBe('CHAVE-DO-SERVIDOR')
  })

  it('repassa o corpo e o content-type nas escritas', async () => {
    const cookie = await loginAs()
    respond = () => Response.json({ id: 9 }, { status: 201 })
    const res = await call('/api/profiles', { method: 'POST', cookie, body: { nome: 'Ana' } })
    expect(res.status).toBe(201)
    expect(JSON.parse(calls[0].body)).toEqual({ nome: 'Ana' })
    expect(calls[0].headers.get('content-type')).toBe('application/json')
  })

  it('deny by default: rotas fora da lista nem chegam à API', async () => {
    const cookie = await loginAs()
    for (const path of [
      '/api/api-keys',
      '/api/tenants',
      '/api/auth',
      '/api/auth/refresh',
      '/api/profiles/../api-keys',
      '/api/profiles/%2e%2e/api-keys',
      '/api/profiles/%2e%2e%2fapi-keys', // um só segmento: casaria com `*` e a API decodificaria o %2f
      '/api/profiles/..%5capi-keys',
      '/api/profiles/1/extra',
    ]) {
      const res = await call(path, { cookie, method: path === '/api/auth' || path === '/api/auth/refresh' ? 'POST' : 'GET' })
      expect(res.status, path).toBe(404)
    }
    expect((await call('/api/profiles/1', { method: 'DELETE', cookie })).status).toBe(404)
    expect(calls).toHaveLength(0)
  })

  it('exige CSRF nas escritas', async () => {
    const cookie = await loginAs()
    const res = await call('/api/profiles', { method: 'POST', cookie, body: {}, csrf: false })
    expect(res.status).toBe(403)
    expect(calls).toHaveLength(0)
  })

  it('rota protegida sem sessão: 401 sem chamar a API', async () => {
    const res = await call('/api/profiles')
    expect(res.status).toBe(401)
    expect((await res.json()).detail.code).toBe('SESSION_REQUIRED')
    expect(calls).toHaveLength(0)
  })

  it('rota pública não envia token, mesmo com sessão', async () => {
    const cookie = await loginAs()
    respond = () => Response.json({ valido: true })
    const res = await call('/api/etapas/2026', { cookie })
    expect(res.status).toBe(200)
    expect(calls[0].headers.get('authorization')).toBeNull()
    expect(calls[0].headers.get('x-api-key')).toBe('CHAVE-DO-SERVIDOR')

    calls = []
    expect((await call('/api/auth/slug/jamar')).status).toBe(200)
    expect(calls[0].path).toBe('/auth/slug/jamar')
  })

  it.each(['/api/auth/primeiro-acesso/senha', '/api/auth/forgot/senha'])(
    '%s: tokens vão para o cookie e nunca para o navegador',
    async (path) => {
      const access = jwt(1800)
      const refreshToken = jwt(36000)
      respond = (p) =>
        p === '/auth/refresh'
          ? Response.json({ access_token: jwt(1800), refresh_token: refreshToken, user: { name: 'Ana' } })
          : Response.json({ access_token: access, refresh_token: refreshToken, token_type: 'bearer' })

      const res = await call(path, { method: 'POST', body: { setup_token: 't', password: 'segredo123' } })
      const text = await res.text()
      expect(res.status).toBe(200)
      expect(JSON.parse(text)).toEqual({ user: { name: 'Ana' } })
      expect(text).not.toContain(access)
      expect(text).not.toContain(refreshToken)
      expect(calls.map((c) => c.path)).toEqual([path.replace('/api', ''), '/auth/refresh'])
      expect(calls[0].headers.get('authorization')).toBeNull()

      const cookie = cookieOf(res)!
      expect(cookie).toBeTruthy()
      expect((await (await call('/api/auth/session', { cookie })).json()).authenticated).toBe(true)
    },
  )

  it('rota startsSession: erro da API passa como veio, sem cookie', async () => {
    respond = () => Response.json({ detail: 'Senha já definida.' }, { status: 400 })
    const res = await call('/api/auth/primeiro-acesso/senha', { method: 'POST', body: {} })
    expect(res.status).toBe(400)
    expect(cookieOf(res)).toBeUndefined()
  })

  it('publicAuthRoutes: só as rotas de senha iniciam sessão', () => {
    const started = publicAuthRoutes.filter((r) => r.startsSession).map((r) => r.path)
    expect(started).toEqual(['/auth/primeiro-acesso/senha', '/auth/forgot/senha'])
    expect(matchRoute(publicAuthRoutes, 'POST', '/auth')).toBeUndefined()
    expect(matchRoute(publicAuthRoutes, 'POST', '/auth/refresh')).toBeUndefined()
  })

  it('não repassa cookies nem headers da API ao navegador', async () => {
    const cookie = await loginAs()
    respond = () => new Response('{}', { headers: { 'content-type': 'application/json', 'set-cookie': 'x=1', 'x-interno': '1' } })
    const res = await call('/api/profiles', { cookie })
    expect(res.headers.get('x-interno')).toBeNull()
    expect(res.headers.getSetCookie().some((c) => c.startsWith('x='))).toBe(false)
  })

  it('renova antes de vencer e atualiza o cookie', async () => {
    const cookie = await loginAs(jwt(5), jwt(36000)) // access vence em 5 s (< folga de 30 s)
    const novo = jwt(1800)
    respond = (path) =>
      path === '/auth/refresh'
        ? Response.json({ access_token: novo, refresh_token: jwt(36000), user: { name: 'Ana', roles: ['admin'] } })
        : Response.json({ ok: true })
    const res = await call('/api/profiles', { cookie })
    expect(res.status).toBe(200)
    expect(calls.map((c) => c.path)).toEqual(['/auth/refresh', '/profiles'])
    expect(calls[1].headers.get('authorization')).toBe(`Bearer ${novo}`)
    const next = cookieOf(res)!
    expect(next).not.toBe(cookie)
    expect((await (await call('/api/auth/session', { cookie: next })).json()).user.roles).toEqual(['admin'])
  })

  it('401 da API: renova e repete uma vez', async () => {
    const cookie = await loginAs()
    const novo = jwt(1800)
    let first = true
    respond = (path) => {
      if (path === '/auth/refresh') return Response.json({ access_token: novo, refresh_token: jwt(36000) })
      if (first) {
        first = false
        return Response.json({ detail: 'Token inválido ou expirado.' }, { status: 401 })
      }
      return Response.json({ ok: true })
    }
    const res = await call('/api/profiles', { cookie })
    expect(res.status).toBe(200)
    expect(calls.map((c) => c.path)).toEqual(['/profiles', '/auth/refresh', '/profiles'])
  })

  it('API_KEY_INVALID não dispara refresh', async () => {
    const cookie = await loginAs()
    respond = () => Response.json({ detail: { code: 'API_KEY_INVALID' } }, { status: 401 })
    const res = await call('/api/profiles', { cookie })
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(1)
  })

  it('refresh recusado encerra a sessão', async () => {
    const cookie = await loginAs(jwt(5), jwt(36000))
    respond = (path) =>
      path === '/auth/refresh'
        ? Response.json({ detail: 'inválido' }, { status: 401 })
        : Response.json({})
    const res = await call('/api/profiles', { cookie })
    expect(res.status).toBe(401)
    expect(calls.map((c) => c.path)).toEqual(['/auth/refresh'])
    const info = await call('/api/auth/session', { cookie: cookieOf(res) })
    expect((await info.json()).authenticated).toBe(false)
  })

  it('erro 5xx no refresh mantém a sessão', async () => {
    const cookie = await loginAs(jwt(5), jwt(36000))
    respond = (path) => (path === '/auth/refresh' ? new Response('x', { status: 503 }) : Response.json({}))
    const res = await call('/api/profiles', { cookie })
    expect(res.status).toBe(401)
    const info = await call('/api/auth/session', { cookie })
    expect((await info.json()).authenticated).toBe(true)
  })
})
