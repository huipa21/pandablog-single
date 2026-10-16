const ADMIN_DEFAULT_PATH = '/admin/dashboard'
const PUBLIC_DEFAULT_PATH = '/'

export function safeInternalPath(value: unknown, fallback = PUBLIC_DEFAULT_PATH) {
  const raw = String(value ?? '')
  // Same-origin paths only: must start with a single '/', never '//' (protocol
  // relative) or '/\' (backslash trick), to prevent open redirects.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) {
    return fallback
  }
  return raw
}

export function resolveLoginRedirect(redirect: unknown) {
  return safeInternalPath(redirect, ADMIN_DEFAULT_PATH)
}