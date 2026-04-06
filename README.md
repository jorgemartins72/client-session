# cliente-session
[![npm version](https://img.shields.io/npm/v/@jorgemartins72/cliente-session.svg?color=blue)](https://www.npmjs.com/package/@jorgemartins72/cliente-session)
[![license](https://img.shields.io/npm/l/@jorgemartins72/cliente-session.svg)](LICENSE)
[![typescript](https://img.shields.io/badge/TypeScript-ready-blue)](https://www.typescriptlang.org/)
[![Nuxt](https://img.shields.io/badge/Nuxt-4.x-green)](https://nuxt.com/)
[![Made in Brazil](https://img.shields.io/badge/Made%20in-Brazil-009739?style=flat&labelColor=yellow)](https://github.com/jamar-dev)

---

## 🇧🇷 Português

**cliente-session** é um gerenciador leve e independente para autenticação e sessão em aplicações **Nuxt/Vue estáticas** — ideal para projetos hospedados em **S3, CloudFront, Netlify** ou qualquer ambiente sem backend Node.

Ele combina **localStorage**, **sessionStorage** e **cookies opcionais** para armazenar tokens e dados do usuário, sem depender de SSR.

---

### ✨ Recursos

- 🧠 Sessão 100% client-side
- 🪶 Nenhuma dependência externa
- 🧱 Compatível com Nuxt 3/4 e Vue 3
- 🔁 Suporte a access_token + refresh_token
- 💾 Pode ser integrado a qualquer API backend
- ⚡ Simples, direto e sem configuração

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

### 🧩 Exemplo de uso

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

### 🧰 Integração com Nuxt

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

### 📘 Documentação da API

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

### 📦 Estrutura de armazenamento

| Tipo             | Dado            | Descrição                                   |
| ---------------- | --------------- | ------------------------------------------- |
| `sessionStorage` | `access_token`  | Token temporário (some ao fechar navegador) |
| `localStorage`   | `refresh_token` | Permite restaurar login depois              |
| `localStorage`   | `user`          | Dados públicos do usuário                   |
| *(opcional)*     | `cookie`        | Flag `isLoggedIn` para middlewares          |

---

### 🧑‍💻 Autor

**Jorge Martins**
[GitHub](https://github.com/jamar-dev) • [Email](mailto:jorge.martins@jamar.dev.br)

---

### ⚖️ Licença
MIT © [Jorge Martins](https://github.com/jamar-dev)

---

## 🇺🇸 English

**cliente-session** is a lightweight and framework-agnostic session manager for **static Nuxt/Vue apps**, perfect for deployments on **S3, CloudFront, Netlify**, or any static hosting without Node backends.

It combines **localStorage**, **sessionStorage**, and optional **cookies** to persist tokens and user data — no SSR required.

---

### ✨ Features

- 🧠 100% client-side session management
- 🪶 Zero dependencies
- 🧱 Works with Nuxt 3/4 and Vue 3
- 🔁 Access + refresh token support
- 💾 Easily integrates with any REST API
- ⚡ Simple, lightweight and direct

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

### 🧩 Usage example

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

### 🧰 Nuxt integration

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

### 📘 API Reference

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

### 📦 Storage strategy

| Layer            | Data            | Purpose                                  |
| ---------------- | --------------- | ---------------------------------------- |
| `sessionStorage` | `access_token`  | Temporary session (cleared on tab close) |
| `localStorage`   | `refresh_token` | Persistent login between sessions        |
| `localStorage`   | `user`          | User metadata                            |
| *(optional)*     | `cookie`        | `isLoggedIn` flag for client middleware  |

---

### ⚖️ License
MIT © [Jorge Martins](https://github.com/jamar-dev)