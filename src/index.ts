// src/index.ts
export interface SessionData {
  user?: any
  access_token?: string
  refresh_token?: string
}

export function setSession(data: SessionData) {
  if (data.access_token) sessionStorage.setItem('access_token', data.access_token)
  if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token)
  if (data.user) localStorage.setItem('user', JSON.stringify(data.user))
}

export function getSession(): SessionData {
  const access_token = sessionStorage.getItem('access_token') || undefined
  const refresh_token = localStorage.getItem('refresh_token') || undefined
  const userStr = localStorage.getItem('user')
  const user = userStr ? JSON.parse(userStr) : undefined
  return { user, access_token, refresh_token }
}

export function clearSession() {
  sessionStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem('user')
}

export function isLoggedIn(): boolean {
  return !!sessionStorage.getItem('access_token')
}
