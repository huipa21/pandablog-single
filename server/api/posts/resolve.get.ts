import { useDb } from '../../utils/db'
import { isOwner } from '../../utils/auth'
import { fetchPostEmbedTargets, type PostEmbedTarget } from '../../utils/postEmbedResolve'
import { PUBLIC_LIST_CACHE_SECONDS, publicCacheKey, shouldBypassPublicCache } from '../../utils/public-cache'

/**
 * Public lookup for embedded post nodes by id anchor. Returns only posts the
 * caller may see: published public/password posts for visitors, everything
 * (including drafts) for the owner. Used by the editor preview and as a
 * client-side fallback when a rendered page carries stale embed data.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Vary', 'Cookie')

  if (await shouldBypassPublicCache(event)) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    return await handleResolve(event)
  }

  return await cachedResolveHandler(event)
})

const cachedResolveHandler = defineCachedEventHandler(handleResolve, {
  name: 'posts-resolve-public-v1',
  maxAge: PUBLIC_LIST_CACHE_SECONDS,
  staleMaxAge: PUBLIC_LIST_CACHE_SECONDS * 2,
  swr: true,
  varies: ['cookie'],
  getKey: event => publicCacheKey(`posts-resolve:${String(getQuery(event).ids ?? '')}`)
})

async function handleResolve(event: Parameters<typeof shouldBypassPublicCache>[0]) {
  const rawIds = String(getQuery(event).ids ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
    .slice(0, 20)
  if (!rawIds.length) {
    return { items: [] }
  }

  const owner = await isOwner(event)
  const db = await useDb()
  const targets = await fetchPostEmbedTargets(db, rawIds, owner)

  const items: PostEmbedTarget[] = rawIds
    .flatMap((id) => {
      const target = targets.get(id) ?? targets.get(`post:${id}`)
      return target ? [target] : []
    })
  return { items }
}
