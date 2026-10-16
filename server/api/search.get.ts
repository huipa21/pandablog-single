import { useDb } from '../utils/db'
import { consumeRateLimit } from '../utils/rate-limit'
import { getRuntimeFlags } from '../utils/settings'
import { getSessionUser } from '../utils/auth'
import { readUnlockedIds } from '../utils/post-password'
import { runPostSearch } from '../utils/postSearch'
import { hasAnySearchCriteria, parseSearchCriteria } from '~/utils/searchQuery'
import type { SearchResponse, SearchSort } from '~/types/content'

/**
 * Public search. Accepts the plain query (`q`) plus the advanced parameters
 * documented in utils/searchQuery.ts (keyword groups, categories incl.
 * sub-categories, tags, date range). Keywords are optional when at
 * least one filter is set.
 *
 * Results depend on the session (drafts for content managers, password /
 * private rules), so responses are never cached publicly.
 */
export default defineEventHandler(async (event): Promise<SearchResponse> => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  setResponseHeader(event, 'Vary', 'Cookie')

  const query = getQuery(event)
  const criteria = parseSearchCriteria(query)
  const sort = normalizeSort(query.sort)
  const limit = clamp(Number(query.limit ?? 20), 1, 50)
  const page = clamp(Number(query.page ?? 1), 1, 500)
  const maxPerPost = clamp(Number(query.maxPerPost ?? 5), 1, 20)

  if (!hasAnySearchCriteria(criteria)) {
    return { query: '', sort, limit, page, pages: 0, total: 0, maxPerPost, results: [] }
  }

  // Throttle search to deter scraping / FTS abuse. Generous enough that a
  // human submitting queries is never affected.
  const ip = getRequestIP(event, { xForwardedFor: getRuntimeFlags().trust_proxy_headers })
  if (ip) {
    const rate = await consumeRateLimit('search', ip, { limit: 30, windowMs: 60_000 })
    if (!rate.allowed) {
      setResponseHeader(event, 'Retry-After', rate.retryAfterSec)
      throw createError({
        statusCode: 429,
        message: `Too many search requests. Try again in ${rate.retryAfterSec}s.`,
      })
    }
  }

  const user = await getSessionUser(event)
  const db = await useDb()
  return await runPostSearch(db, {
    criteria,
    sort,
    page,
    limit,
    maxPerPost,
    viewer: { user, unlockedIds: readUnlockedIds(event) }
  })
})

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.floor(value)))
}

function normalizeSort(value: unknown): SearchSort {
  if (value === 'date_desc' || value === 'date_asc' || value === 'title' || value === 'relevance') {
    return value
  }
  return 'relevance'
}
