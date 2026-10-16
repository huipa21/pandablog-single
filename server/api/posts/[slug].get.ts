import { queryDb, useDb } from '../../utils/db'
import { normalizePost } from '../../utils/content'
import { firstRow, queryRows, recordIdPart, stringifyRecordId } from '../../utils/surrealResult'
import { evaluatePostAccess, sanitizePost, type PostVisibility } from '../../utils/visibility'
import { buildDocFromBlocks, loadBlocksForPost } from '../../utils/blocks'
import { isOwner } from '../../utils/auth'
import { PUBLIC_POST_CACHE_SECONDS, publicCacheKey, shouldBypassPublicCache } from '../../utils/public-cache'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Vary', 'Cookie')

  if (await shouldBypassPublicCache(event)) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    return await handlePost(event)
  }

  return await cachedPostHandler(event)
})

const cachedPostHandler = defineCachedEventHandler(handlePost, {
  name: 'posts-slug-public-v1',
  maxAge: PUBLIC_POST_CACHE_SECONDS,
  staleMaxAge: PUBLIC_POST_CACHE_SECONDS * 2,
  swr: true,
  varies: ['cookie'],
  getKey: event => publicCacheKey(`post:${getRouterParam(event, 'slug') ?? ''}`)
})

async function handlePost(event: Parameters<typeof shouldBypassPublicCache>[0]) {
  setResponseHeader(event, 'Vary', 'Cookie')

  const slug = getRouterParam(event, 'slug')

  if (!slug) {
    throw createError({ statusCode: 400, message: 'Slug is required' })
  }

  const db = await useDb()
  const owner = await isOwner(event)
  const visibleStatuses = owner ? ['published', 'draft'] : ['published']
  const response = await queryDb(
    db,
    `SELECT id, title, slug, summary, status, cover_image,
      published_at, created_at, updated_at, view_count, word_count, cjk_char_count,
      visibility, password_hint
     FROM post WHERE slug = $slug AND status IN $visibleStatuses LIMIT 1;`,
    { slug, visibleStatuses }
  )
  const post = firstRow<Record<string, unknown>>(response)

  if (!post) {
    throw createError({ statusCode: 404, message: 'Post not found' })
  }

  const access = await evaluatePostAccess(event, {
    id: stringifyRecordId(post.id),
    visibility: toPostVisibility(post.visibility)
  })

  if (access.state === 'site-private') {
    const currentPath = event.path ?? `/api/posts/${slug}`
    return sendRedirect(event, `/login?redirect=${encodeURIComponent(currentPath)}`, 302)
  }

  if (access.state === 'not-found') {
    throw createError({ statusCode: 404, message: 'Post not found' })
  }

  if (access.state === 'locked') {
    return {
      locked: true,
      slug: String(post.slug ?? slug),
      title: String(post.title ?? ''),
      visibility: 'password' as const,
      passwordHint: post.password_hint === undefined ? null : post.password_hint
    }
  }

  const sanitized = sanitizePost(post)
  const normalized = normalizePost(sanitized)
  const [blocks, tags] = await Promise.all([
    loadBlocksForPost(db, normalized.id),
    loadTagsForPost(db, normalized.id)
  ])

  return {
    ...normalized,
    content_json: buildDocFromBlocks(blocks),
    blocks,
    tags
  }
}

function toPostVisibility(value: unknown): PostVisibility {
  return value === 'private' || value === 'password' ? value : 'public'
}

async function loadTagsForPost(db: Awaited<ReturnType<typeof useDb>>, postRecordId: string) {
  const postId = recordIdPart(postRecordId, 'post')
  const response = await queryDb(
    db,
    `SELECT out.name AS name, out.slug AS slug
     FROM tagged
     WHERE in = type::record('post', $postId)
     FETCH out;`,
    { postId }
  )

  return queryRows<Record<string, unknown>>(response)
    .map((row) => ({
      name: String(row.name ?? '').trim(),
      slug: String(row.slug ?? '').trim()
    }))
    .filter((tag) => tag.name && tag.slug)
}
