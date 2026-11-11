import { describe, expect, it, vi } from 'vitest'
import { createSessionClient, SessionError } from '../src/client'

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit; headers: Headers }[] = []
  const fn = vi.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init, headers: new Headers(init.headers) })
    return handler(String(url), init)
  }) as unknown as typeof fetch
  return { fn, calls }
}

describe('createSessionClient (modo server)', () => {
  it('load: autenticado e anônimo, notificando quem assina', async () => {
    const f = fakeFetch(() => Response.json({ authenticated: true, user: { name: 'Ana' } }))
    const client = createSessionClient({ mode: 'server', fetch: f.fn })
    const seen: string[] = []
    client.subscribe((s) => seen.push(s.status))

    await client.load()
    expect(client.getState()).toEqual({ status: 'authenticated', user: { name: 'Ana' } })
    expect(seen).toEqual(['loading', 'authenticated'])
    expect(f.calls[0].url).toBe('/api/auth/session')
    expect(f.calls[0].init.credentials).toBe('same-origin')

    const anon = createSessionClient({ mode: 'server', fetch: fakeFetch(() => new Response('x', { status: 500 })).fn })
    await anon.load()
    expect(anon.getState()).toEqual({ status: 'anonymous', user: null })
  })

  it('login envia o header CSRF e guarda só o usuário', async () => {
    const f = fakeFetch(() => Response.json({ user: { name: 'Ana' } }))
    const client = createSessionClient({ mode: 'server', fetch: f.fn })
    await client.login({ email: 'a@a.com', password: 'x' })
    expect(client.getState().user).toEqual({ name: 'Ana' })
    expect(f.calls[0].url).toBe('/api/auth/login')
    expect(f.calls[0].headers.get('x-requested-with')).toBe('cliente-session')
  })

  it('login com erro lança SessionError com o corpo da API', async () => {
    const f = fakeFetch(() => Response.json({ detail: { code: 'USER_INACTIVE' } }, { status: 401 }))
    const client = createSessionClient({ mode: 'server', fetch: f.fn })
    const err = await client.login({ email: 'a@a.com', password: 'x' }).catch((e) => e)
    expect(err).toBeInstanceOf(SessionError)
    expect(err.status).toBe(401)
    expect(err.data.detail.code).toBe('USER_INACTIVE')
    expect(client.getState().status).toBe('idle')
  })

  it('logout volta para anônimo mesmo se a chamada falhar', async () => {
    const f = fakeFetch((url) => (url.endsWith('/login') ? Response.json({ user: {} }) : new Response('x', { status: 500 })))
    const client = createSessionClient({ mode: 'server', fetch: f.fn })
    await client.login({ email: 'a', password: 'b' })
    await client.logout().catch(() => {})
    expect(client.getState()).toEqual({ status: 'anonymous', user: null })
  })

  it('fetch usa o proxy e derruba o estado em 401', async () => {
    const f = fakeFetch((url) => {
      if (url.endsWith('/login')) return Response.json({ user: { name: 'Ana' } })
      if (url === '/api/profiles') return Response.json({ detail: { code: 'SESSION_REQUIRED' } }, { status: 401 })
      return Response.json({ ok: true })
    })
    const client = createSessionClient({ mode: 'server', fetch: f.fn })
    await client.login({ email: 'a', password: 'b' })

    expect(await client.fetch('/etapas')).toEqual({ ok: true })
    expect(f.calls.at(-1)!.url).toBe('/api/etapas')

    await client.fetch('/profiles').catch(() => {})
    expect(client.getState().status).toBe('anonymous')
  })

  it('basePath e apiPath personalizados', async () => {
    const f = fakeFetch(() => Response.json({ authenticated: false }))
    const client = createSessionClient({ mode: 'server', basePath: '/x/auth/', apiPath: '/x', fetch: f.fn })
    await client.load()
    expect(f.calls[0].url).toBe('/x/auth/session')
  })
})
