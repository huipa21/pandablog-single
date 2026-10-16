import { getRequestHeader, getRequestIP, setResponseStatus } from 'h3'
import { readBoundedJson } from '../../utils/bounded-json'
import { isAnalyticsBot } from '../../utils/analytics/bots'
import { hashAnalyticsVisitor } from '../../utils/analytics/hash'
import { normalizeAnalyticsPath, normalizeAnalyticsReferrer } from '../../utils/analytics/path'
import { recordAnalyticsPageview } from '../../utils/analytics/session'
import { isOwner } from '../../utils/auth'
import { queryDb, useDb } from '../../utils/db'
import { consumeRateLimit } from '../../utils/rate-limit'
import { getAnalyticsSettings, getRuntimeFlags } from '../../utils/settings'
import { evaluatePostAccess, type PostVisibility } from '../../utils/visibility'
import { firstRow, recordIdPart, stringifyRecordId } from '../../utils/surrealResult'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBoundedJson(event, 8 * 1024)
    const path = normalizeAnalyticsPath(body.path)
    if (!path) {
      return emptyTrackingResponse(event)
    }

    const trackedPostSlug = extractBlogSlug(path)
    const settings = getAnalyticsSettings()
    if (!settings.analytics_enabled && !trackedPostSlug) {
      return emptyTrackingResponse(event)
    }

    const userAgent = (getRequestHeader(event, 'user-agent') ?? '').slice(0, 1024)
    if (isAnalyticsBot(userAgent)) {
      return emptyTrackingResponse(event)
    }

    // Silently drop floods of tracking beacons from a single IP so they can't
    // inflate view counts or balloon the pageview table. Analytics is
    // fire-and-forget, so over-limit requests get an empty 204, not a 429.
    const rateLimitIp = getRequestIP(event, { xForwardedFor: getRuntimeFlags().trust_proxy_headers })
      || event.node.req.socket.remoteAddress
      || ''
    if (rateLimitIp) {
      const rate = await consumeRateLimit('analytics', rateLimitIp, { limit: 120, windowMs: 60_000 })
      if (!rate.allowed) {
        return emptyTrackingResponse(event)
      }
    }

    const db = await useDb()

    if (trackedPostSlug) {
      await incrementTrackedPostView(db, event, trackedPostSlug)
    }

    if (!settings.analytics_enabled) {
      return emptyTrackingResponse(event)
    }

    // Don't record the owner's own page views as public analytics.
    if (await isOwner(event)) {
      return emptyTrackingResponse(event)
    }

    const ip = getRequestIP(event, { xForwardedFor: getRuntimeFlags().trust_proxy_headers })
      || event.node.req.socket.remoteAddress
      || ''
    if (!ip) {
      return emptyTrackingResponse(event)
    }

    const now = new Date()
    const visitorHash = await hashAnalyticsVisitor(ip, userAgent)
    const referrer = normalizeAnalyticsReferrer(body.referrer ?? getRequestHeader(event, 'referer'))
    await recordAnalyticsPageview(db, visitorHash, now, settings.analytics_session_window_minutes, {path, referrer})

  } catch (error) {
    if (import.meta.dev) {
      console.warn('[analytics] tracking skipped:', error instanceof Error ? error.message : error)
    }
  }

  return emptyTrackingResponse(event)
})

function emptyTrackingResponse(event: Parameters<typeof setResponseStatus>[0]) {
  setResponseStatus(event, 204)
  return null
}

async function incrementTrackedPostView(db: Awaited<ReturnType<typeof useDb>>, event: Parameters<typeof isOwner>[0], slug: string) {
  try {
    if (await isOwner(event)) {
      return
    }

    const response = await queryDb(
      db,
      `SELECT id, visibility
       FROM post
       WHERE slug = $slug AND status = 'published'
       LIMIT 1;`,
      { slug },
      { label: 'analytics post view lookup', timeoutMs: 5_000 }
    )
    const post = firstRow<Record<string, unknown>>(response)
    if (!post) {
      return
    }

    const access = await evaluatePostAccess(event, {
      id: stringifyRecordId(post.id),
      visibility: toPostVisibility(post.visibility)
    })

    if (access.state !== 'allow') {
      return
    }

    await queryDb(
      db,
      'UPDATE type::record($table, $id) SET view_count += 1;',
      { table: 'post', id: recordIdPart(stringifyRecordId(post.id), 'post') },
      { label: 'analytics post view count increment', timeoutMs: 5_000, retryOnReconnect: false }
    )
  } catch (error) {
    if (import.meta.dev) {
      console.warn('[analytics] post view count skipped:', error instanceof Error ? error.message : error)
    }
  }
}

function extractBlogSlug(path: string) {
  const url = new URL(path, 'http://local.invalid')
  const match = /^\/blog\/([^/]+)\/?$/.exec(url.pathname)
  const slug = match?.[1]
  return slug ? decodeURIComponent(slug) : null
}

function toPostVisibility(value: unknown): PostVisibility {
  return value === 'public' || value === 'password' ? value : 'private'
}
