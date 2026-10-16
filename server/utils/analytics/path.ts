const EXCLUDED_PATH_PREFIXES = [
  '/admin',
  '/api',
  '/login',
  '/_nuxt',
  '/__nuxt',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml'
]

export function normalizeAnalyticsPath(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 2048) {
    return null
  }

  try {
    const url = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? new URL(trimmed)
      : new URL(trimmed, 'http://local.invalid')
    const path = `${url.pathname}${url.search}`
    if (Buffer.byteLength(path) > 2048 || !path.startsWith('/') || EXCLUDED_PATH_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`))) {
      return null
    }

    return path
  } catch {
    return null
  }
}

export function normalizeAnalyticsReferrer(value: unknown) {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  return Buffer.byteLength(trimmed) <= 2048 ? trimmed : undefined
}
