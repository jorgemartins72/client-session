// Constantes usadas pelo cliente (navegador) e pelo servidor (h3).

/**
 * Header exigido em toda requisição que altera estado (POST, PUT, PATCH, DELETE).
 * Um header customizado força o navegador a fazer preflight em requisições entre origens,
 * o que bloqueia CSRF além do `SameSite` do cookie.
 */
export const CSRF_HEADER = 'x-requested-with'
export const CSRF_VALUE = 'cliente-session'

export const SAFE_METHODS = ['GET', 'HEAD']
