# cliente-session
[![npm version](https://img.shields.io/npm/v/@jorgemartins72/cliente-session.svg?color=blue)](https://www.npmjs.com/package/@jorgemartins72/cliente-session)
[![license](https://img.shields.io/npm/l/@jorgemartins72/cliente-session.svg)](LICENSE)
[![typescript](https://img.shields.io/badge/TypeScript-ready-blue)](https://www.typescriptlang.org/)
[![Nuxt](https://img.shields.io/badge/Nuxt-4.x-green)](https://nuxt.com/)
[![Made in Brazil](https://img.shields.io/badge/Made%20in-Brazil-009739?style=flat&labelColor=yellow)](https://github.com/jamar-dev)

---

## 🇧🇷 Português

**cliente-session** é um gerenciador de autenticação e sessão para aplicações **Nuxt/Vue**, com **dois modos**:

| | Modo `browser` | Modo `server` (v0.3.0) |
|---|---|---|
| Onde fica a sessão | No navegador (`localStorage` e `sessionStorage`) | No servidor: cookie selado `HttpOnly` |
| Tokens acessíveis ao JavaScript | Sim (um XSS consegue lê-los) | **Não** |
| `X-API-Key` | Vai no código do navegador | Fica só no servidor |
| Exige backend Node (Nitro/Lambda) | Não, funciona em hospedagem estática | Sim (h3 1.x) |
| Dependências | Nenhuma | `h3` (peerDependency opcional) |
| Importar de | `@jorgemartins72/cliente-session` | `@jorgemartins72/cliente-session/server` + `createSessionClient` |

Use o `browser` para sites estáticos simples (S3, CloudFront, Netlify) em que guardar o token no navegador é aceitável. Use o `server` quando for preciso proteger os tokens contra XSS e esconder a chave da API.

---

### ✨ Recursos

- 🧠 Dois modos: sessão no navegador (`browser`) ou no servidor (`server`)
- 🪶 Modo `browser` sem dependências; o modo `server` usa `h3` (peerDependency opcional)
- 🧱 Feito para Nuxt/Vue (modo `server` com testes automatizados sobre h3 1.15)
- 🔁 Suporte a access_token + refresh_token
- 🛡️ Modo `server`: tokens fora do JavaScript, proxy com lista de rotas permitidas, CSRF e refresh automático
- 💾 Integra com qualquer API REST

---

### 🚀 Instalação

```bash
npm install @jorgemartins72/cliente-session
```

ou

```bash
pnpm add @jorgemartins72/cliente-session
```

---

### 🧩 Exemplo de uso (modo `browser`)

```ts
import { setSession, getSession, clearSession, isLoggedIn } from '@jorgemartins72/cliente-session'

// Criar uma sessão
setSession({
  user: { name: 'Jorge Martins' },
  access_token: 'abc123',
  refresh_token: 'xyz456'
})

// Recuperar sessão
const { user, access_token } = getSession()

// Verificar se há login ativo
if (isLoggedIn()) {
  console.log(`Usuário ativo: ${user?.name}`)
}

// Encerrar sessão
clearSession()
```

---

### 🧰 Integração com Nuxt (modo `browser`)

Você pode criar um **plugin** que injeta o token automaticamente nas requisições:

```ts
// plugins/api.client.ts
import { getSession } from '@jorgemartins72/cliente-session'

export default defineNuxtPlugin(() => {
  return {
    provide: {
      api: async (path: string, options: any = {}) => {
        const { access_token } = getSession()
        const headers = {
          ...(options.headers || {}),
          ...(access_token ? { Authorization: `Bearer ${access_token}` } : {})
        }

        return await $fetch(`${useRuntimeConfig().public.apiBase}${path}`, {
          ...options,
          headers
        })
      }
    }
  }
})
```

---

### 📘 Documentação da API (modo `browser`)

#### 🧩 `setSession(data: SessionData)`

Cria ou atualiza a sessão atual.

| Parâmetro       | Tipo                  | Descrição                                      |
| --------------- | --------------------- | ---------------------------------------------- |
| `user`          | `any`                 | Dados do usuário (ex: nome, permissões, email) |
| `access_token`  | `string`              | Token de acesso atual (curto prazo)            |
| `refresh_token` | `string` *(opcional)* | Token de renovação (persistente)               |

**Exemplo:**
```ts
setSession({
  user: { name: 'Jorge' },
  access_token: 'abc123',
  refresh_token: 'xyz456'
})
```

---

#### 🧩 `getSession(): SessionData`

Recupera a sessão atual, unindo dados de `localStorage` e `sessionStorage`.

**Retorno:**
```ts
{
  user?: any
  access_token?: string
  refresh_token?: string
}
```

**Exemplo:**
```ts
const { user, access_token } = getSession()
console.log(user?.name, access_token)
```

---

#### 🧩 `clearSession()`

Remove todos os dados da sessão (tokens e usuário).

```ts
clearSession()
```

---

#### 🧩 `isLoggedIn(): boolean`

Verifica se há um token de acesso ativo na sessão.

```ts
if (isLoggedIn()) {
  console.log('Usuário autenticado')
}
```

---

### 📦 Estrutura de armazenamento (modo `browser`)

| Tipo             | Dado            | Descrição                                   |
| ---------------- | --------------- | ------------------------------------------- |
| `sessionStorage` | `access_token`  | Token temporário (some ao fechar navegador) |
| `localStorage`   | `refresh_token` | Permite restaurar login depois              |
| `localStorage`   | `user`          | Dados públicos do usuário                   |

Tudo isso fica legível por qualquer script da página: um XSS consegue ler os tokens. Se isso não for aceitável, use o modo `server`.

---

### 🛡️ Modo `server` (v0.3.0)

Para sites que precisam proteger tokens contra XSS e esconder a `X-API-Key`. O Nuxt roda como **proxy (BFF)** em Nitro/Lambda: os tokens e a chave ficam **só no servidor**, e o navegador recebe apenas um **cookie selado `HttpOnly`** e os dados públicos do usuário. O modo `browser` acima continua igual.

`h3` (1.x) é `peerDependency` opcional: só é necessário em `@jorgemartins72/cliente-session/server`.

**1. Servidor** (cada arquivo de rota do Nuxt vira uma linha):

```ts
// server/utils/session.ts
import { createSessionServer, publicAuthRoutes } from '@jorgemartins72/cliente-session/server'

export const sessionServer = createSessionServer((event) => {
  const c = useRuntimeConfig(event) // apiBase, apiKey, sessionPassword (privados)
  return {
    apiBase: c.apiBase,
    apiKey: c.apiKey,
    password: c.sessionPassword, // 32+ caracteres
    organization: 'jamar',
    secure: !import.meta.dev, // Secure não funciona em http://localhost no Safari
    routes: [
      ...publicAuthRoutes, // slug, cadastro, primeiro acesso, esqueci a senha
      { methods: ['GET', 'POST'], path: '/profiles' },
      { methods: 'GET', path: '/etapas/**', auth: 'none' }, // pública, sem token
    ],
  }
})
```

```ts
// server/api/auth/login.post.ts    -> export default sessionServer.login
// server/api/auth/session.get.ts   -> export default sessionServer.session
// server/api/auth/reload.post.ts   -> export default sessionServer.reload
// server/api/auth/logout.post.ts   -> export default sessionServer.logout
// server/api/[...].ts              -> export default sessionServer.proxy
```

**2. Navegador:**

```ts
import { createSessionClient } from '@jorgemartins72/cliente-session'

const session = createSessionClient({ mode: 'server' })

await session.load() // ao abrir o site: lê o estado do servidor
await session.login({ email, password }) // erro: SessionError (err.data.detail.code)
const perfis = await session.fetch('/profiles') // passa pelo proxy
await session.reload() // depois de editar o usuário: atualiza o `user` guardado no cookie
await session.logout()

session.getState() // { status: 'idle' | 'loading' | 'authenticated' | 'anonymous', user }
session.subscribe((state) => { /* reativo: ligue a um ref/useState */ })
```

**O que o proxy garante**

| Proteção | Como |
|---|---|
| Deny by default | Só passam as rotas da lista `routes`; o resto responde `404` sem chamar a API |
| Tokens fora do JS | O login devolve só `{ user }`; o cookie é `HttpOnly`, selado e `SameSite=Lax` |
| Chave do tenant | `Authorization` e `X-API-Key` enviados pelo navegador são descartados; valem só os do servidor |
| CSRF | Toda escrita (POST, PUT, PATCH, DELETE) exige o header `X-Requested-With: cliente-session` (o cliente já envia) |
| Escape de caminho | `..`, `%2e%2e`, `%2f`, `\` e caracteres de controle são rejeitados |
| Refresh | Renova o access token antes de vencer e repete uma vez a chamada que receber `401` |
| Login automático | Rotas com `startsSession` (definir/redefinir senha) guardam os tokens no cookie e devolvem só `{ user }` |
| Respostas | Só o status e o `content-type` voltam; `Set-Cookie` e demais headers da API são descartados |

**Limites e cuidados**
- `POST /auth` e `/auth/refresh` **não** estão em `publicAuthRoutes` de propósito: tokens nunca devem chegar ao navegador. Rotas da API que fazem login automático (ex.: definir a senha) devem usar `startsSession: true`: o servidor guarda os tokens no cookie e devolve só `{ user }`. Confira se alguma rota que você liberar devolve tokens no corpo.
- O cookie selado cresce ~1,4x e os navegadores descartam cookies acima de ~4 KB. O pacote recusa gravar dados grandes (erro 500 claro); mantenha `user` enxuto.
- O `user` fica no cookie e só é renovado junto com os tokens (cerca de 30 min). Depois de alterar dados do usuário na API, chame `session.reload()` (`POST /api/auth/reload`): o servidor renova os tokens e traz o `user` atual (a API precisa devolver o usuário em `/auth/refresh`).
- A sessão é stateless: não há como revogá-la no servidor antes de `maxAge` (padrão 10 h). O logout só apaga o cookie do navegador.
- O refresh assume que a API aceita o mesmo refresh token em requisições paralelas (sem rotação com revogação).

---

### 🧑‍💻 Autor

**Jorge Martins**
[GitHub](https://github.com/jamar-dev) • [Email](mailto:jorge.martins@jamar.dev.br)

---

### ⚖️ Licença
MIT © [Jorge Martins](https://github.com/jamar-dev)

---

## 🇺🇸 English

**cliente-session** is an authentication and session manager for **Nuxt/Vue** apps, with **two modes**:

| | `browser` mode | `server` mode (v0.3.0) |
|---|---|---|
| Where the session lives | In the browser (`localStorage` / `sessionStorage`) | On the server: sealed `HttpOnly` cookie |
| Tokens readable by JavaScript | Yes (an XSS can read them) | **No** |
| `X-API-Key` | Shipped in the browser code | Stays on the server |
| Needs a Node backend (Nitro/Lambda) | No, works on static hosting | Yes (h3 1.x) |
| Dependencies | None | `h3` (optional peerDependency) |
| Import from | `@jorgemartins72/cliente-session` | `@jorgemartins72/cliente-session/server` + `createSessionClient` |

Use `browser` for simple static sites (S3, CloudFront, Netlify) where keeping the token in the browser is acceptable. Use `server` when tokens must be protected from XSS and the API key hidden.

---

### ✨ Features

- 🧠 Two modes: session in the browser (`browser`) or on the server (`server`)
- 🪶 `browser` mode has no dependencies; `server` mode uses `h3` (optional peerDependency)
- 🧱 Built for Nuxt/Vue (`server` mode covered by automated tests on h3 1.15)
- 🔁 Access + refresh token support
- 🛡️ `server` mode: tokens kept out of JavaScript, allow-listed proxy, CSRF and automatic refresh
- 💾 Works with any REST API

---

### 🚀 Installation

```bash
npm install @jorgemartins72/cliente-session
```

or

```bash
pnpm add @jorgemartins72/cliente-session
```

---

### 🧩 Usage example (`browser` mode)

```ts
import { setSession, getSession, clearSession, isLoggedIn } from '@jorgemartins72/cliente-session'

setSession({
  user: { name: 'Jorge Martins' },
  access_token: 'abc123',
  refresh_token: 'xyz456'
})

const { user, access_token } = getSession()

if (isLoggedIn()) {
  console.log(`Logged in as: ${user?.name}`)
}

clearSession()
```

---

### 🧰 Nuxt integration (`browser` mode)

```ts
import { getSession } from '@jorgemartins72/cliente-session'

export default defineNuxtPlugin(() => {
  return {
    provide: {
      api: async (path: string, options: any = {}) => {
        const { access_token } = getSession()
        const headers = {
          ...(options.headers || {}),
          ...(access_token ? { Authorization: `Bearer ${access_token}` } : {})
        }

        return await $fetch(`${useRuntimeConfig().public.apiBase}${path}`, {
          ...options,
          headers
        })
      }
    }
  }
})
```

---

### 📘 API Reference (`browser` mode)

#### `setSession(data: SessionData)`

Creates or updates the session.

| Param           | Type                  | Description                          |
| --------------- | --------------------- | ------------------------------------ |
| `user`          | `any`                 | User data (name, email, permissions) |
| `access_token`  | `string`              | Short-lived token for API requests   |
| `refresh_token` | `string` *(optional)* | Long-lived token for renewals        |

---

#### `getSession(): SessionData`

Returns the current session from storage.

```ts
const { user, access_token } = getSession()
```

---

#### `clearSession()`

Removes all session data.

---

#### `isLoggedIn(): boolean`

Returns `true` if an access token exists in sessionStorage.

---

### 📦 Storage strategy (`browser` mode)

| Layer            | Data            | Purpose                                  |
| ---------------- | --------------- | ---------------------------------------- |
| `sessionStorage` | `access_token`  | Temporary session (cleared on tab close) |
| `localStorage`   | `refresh_token` | Persistent login between sessions        |
| `localStorage`   | `user`          | User metadata                            |

All of it is readable by any script on the page: an XSS can read the tokens. If that is not acceptable, use `server` mode.

---

### 🛡️ `server` mode (v0.3.0)

For sites that must keep tokens away from XSS and hide the `X-API-Key`. Nuxt runs as a **proxy (BFF)** on Nitro/Lambda: tokens and the key stay **on the server only**; the browser gets a **sealed `HttpOnly` cookie** and the public user data. The `browser` mode above is unchanged.

`h3` (1.x) is an optional `peerDependency`, needed only by `@jorgemartins72/cliente-session/server`.

```ts
// server: createSessionServer(options | (event) => options) returns { login, session, reload, logout, proxy }
import { createSessionServer, publicAuthRoutes } from '@jorgemartins72/cliente-session/server'

// browser:
import { createSessionClient } from '@jorgemartins72/cliente-session'
const session = createSessionClient({ mode: 'server' })
await session.load()
await session.login({ email, password })
await session.fetch('/profiles') // goes through the proxy
await session.reload() // after editing the user: refreshes the `user` stored in the cookie
```

Highlights: deny-by-default route list, tokens never reach JS, browser-sent `Authorization`/`X-API-Key` are dropped, CSRF header required on writes, path-escape rejection (`..`, `%2f`), automatic refresh with one retry on `401`, and upstream cookies/headers are never forwarded. See the Portuguese section for the full example and caveats (cookie size ~4 KB, stateless sessions, refresh without rotation).

---

### ⚖️ License
MIT © [Jorge Martins](https://github.com/jamar-dev)