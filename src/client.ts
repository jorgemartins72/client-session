// Cliente de sessão do modo `server`: nenhum token passa pelo navegador.
// Fala com os handlers de `@jorgemartins72/cliente-session/server` (cookie HttpOnly).
import { CSRF_HEADER, CSRF_VALUE, SAFE_METHODS } from './shared'

export interface SessionClientOptions {
  mode: 'server'
  /** Onde estão as rotas de login/sessão/logout no Nuxt. Padrão: `/api/auth`. */
  basePath?: string
  /** Prefixo do proxy para `client.fetch`. Padrão: `/api`. */
  apiPath?: string
  /** Substitui o `fetch` global (testes, SSR). */
  fetch?: typeof fetch
}

export type SessionStatus = 'idle' | 'loading' | 'authenticated' | 'anonymous'

export interface SessionState<U = any> {
  status: SessionStatus
  user: U | null
}

/** Erro de uma chamada: `status` HTTP e `data` com o corpo da API (ex.: `data.detail.code`). */
export class SessionError extends Error {
  status: number
  data: any
  constructor(status: number, data: any) {
    super(typeof data?.detail === 'string' ? data.detail : data?.detail?.message ?? `Erro ${status}`)
    this.name = 'SessionError'
    this.status = status
    this.data = data
  }
}

export function createSessionClient<U = any>(options: SessionClientOptions) {
  const basePath = (options.basePath ?? '/api/auth').replace(/\/+$/, '')
  const apiPath = (options.apiPath ?? '/api').replace(/\/+$/, '')
  const doFetch = (input: string, init?: RequestInit) => (options.fetch ?? fetch)(input, init)

  let state: SessionState<U> = { status: 'idle', user: null }
  const listeners = new Set<(s: SessionState<U>) => void>()

  const set = (next: SessionState<U>) => {
    state = next
    listeners.forEach((fn) => fn(state))
  }

  const request = async (input: string, init: RequestInit = {}): Promise<any> => {
    const method = (init.method ?? 'GET').toUpperCase()
    const headers = new Headers(init.headers)
    if (!SAFE_METHODS.includes(method)) headers.set(CSRF_HEADER, CSRF_VALUE)
    const res = await doFetch(input, { ...init, method, headers, credentials: 'same-origin' })
    const text = await res.text()
    let data: any = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      data = { detail: text }
    }
    if (!res.ok) throw new SessionError(res.status, data)
    return data
  }

  return {
    /** Estado atual (snapshot). Use `subscribe` para reagir a mudanças. */
    getState: () => state,

    /** Chama `fn` a cada mudança de estado. Devolve a função para cancelar. */
    subscribe(fn: (s: SessionState<U>) => void) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },

    /** Consulta o servidor (ex.: ao abrir o site) e atualiza o estado. */
    async load() {
      set({ ...state, status: 'loading' })
      try {
        const data = await request(`${basePath}/session`)
        set(data?.authenticated ? { status: 'authenticated', user: data.user } : { status: 'anonymous', user: null })
      } catch {
        set({ status: 'anonymous', user: null })
      }
      return state
    },

    /** Faz login. Em caso de erro lança `SessionError` (`err.data.detail.code`, ex.: PASSWORD_NOT_SET). */
    async login(credentials: { email: string; password: string }) {
      const data = await request(`${basePath}/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(credentials),
      })
      set({ status: 'authenticated', user: data?.user ?? null })
      return state
    },

    /**
     * Pede ao servidor para renovar o `user` da sessão (use depois de editar os dados do usuário).
     * Sem sessão (401), o estado volta para `anonymous`.
     */
    async reload() {
      try {
        const data = await request(`${basePath}/reload`, { method: 'POST' })
        set({ status: 'authenticated', user: data?.user ?? null })
      } catch (err) {
        if (err instanceof SessionError && err.status === 401) set({ status: 'anonymous', user: null })
        throw err
      }
      return state
    },

    async logout() {
      try {
        await request(`${basePath}/logout`, { method: 'POST' })
      } finally {
        set({ status: 'anonymous', user: null })
      }
    },

    /**
     * Chama a API pelo proxy do servidor (ex.: `client.fetch('/profiles')`). Se a sessão
     * expirar (401 `SESSION_REQUIRED`), o estado volta para `anonymous`.
     */
    async fetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
      try {
        return await request(`${apiPath}${path}`, init)
      } catch (err) {
        if (err instanceof SessionError && err.status === 401 && state.status === 'authenticated') {
          set({ status: 'anonymous', user: null })
        }
        throw err
      }
    },
  }
}

export type SessionClient<U = any> = ReturnType<typeof createSessionClient<U>>
