import { privateMediaHeaders } from '../utils/media-cache'
import { isMaintenanceDiagnosticRequest } from '../utils/maintenance-handler'
import { getSiteVisibility } from '../utils/visibility'
import { isOwner } from '../utils/auth'

const ALWAYS_ALLOWED_PREFIXES = [
  '/api/auth',
  '/api/site/bootstrap',
  '/api/site/visibility',
  '/api/health',
  '/api/theme/css',
  '/_nuxt',
  '/__nuxt',
  '/_i18n',
  '/api/_nuxt'
]

const ALWAYS_ALLOWED_EXACT = new Set([
  '/login',
  '/favicon.ico',
  '/robots.txt',
  '/sitemap.xml'
])

export default defineEventHandler(async (event) => {
  const requestUrl = getRequestURL(event)
  const url = requestUrl.pathname
  const originalUrl = event.node.req.url ?? requestUrl.pathname
  if (url.startsWith('/media/') || url.startsWith('/api/media/')) privateMediaHeaders(event)

  // Readiness/health/static diagnostics must never allocate a visibility DB
  // client while boot is fenced (that rejected shared flight can poison boot).
  // Status keeps its exact job-capability/current-owner authorization.
  if (isMaintenanceDiagnosticRequest(event.method, url)) return
  if (ALWAYS_ALLOWED_EXACT.has(url)) return

  for (const prefix of ALWAYS_ALLOWED_PREFIXES) {
    if (url === prefix || url.startsWith(prefix + '/') || url.startsWith(prefix + '?')) {
      return
    }
  }

  const site = await getSiteVisibility()
  if (site === 'public') return

  if (await isOwner(event)) return

  if (url.startsWith('/api/')) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  return sendRedirect(event, `/login?redirect=${encodeURIComponent(originalUrl)}`, 302)
})
