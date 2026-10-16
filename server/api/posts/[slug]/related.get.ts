import type { H3Event } from 'h3'
import { queryDb, useDb } from '../../../utils/db'
import { isOwner } from '../../../utils/auth'
import { firstRow, queryRows, recordIdPart, stringifyRecordId } from '../../../utils/surrealResult'
import { PUBLIC_LIST_CACHE_SECONDS, publicCacheKey, shouldBypassPublicCache } from '../../../utils/public-cache'
import type { PostListItem, PostVisibility } from '~/types/content'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Vary', 'Cookie')

  if (await shouldBypassPublicCache(event)) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    return await handleRelatedPosts(event)
  }

  return await cachedRelatedPostsHandler(event)
})

const cachedRelatedPostsHandler = defineCachedEventHandler(handleRelatedPosts, {
  name: 'posts-related-public-v1',
  maxAge: PUBLIC_LIST_CACHE_SECONDS,
  staleMaxAge: PUBLIC_LIST_CACHE_SECONDS * 2,
  swr: true,
  varies: ['cookie'],
  getKey: event => publicCacheKey(`posts-related:${getRouterParam(event, 'slug') ?? ''}`)
})

async function handleRelatedPosts(event: H3Event) {
  const slug = String(getRouterParam(event, 'slug') ?? '').trim()
  if (!slug) {
    throw createError({ statusCode: 400, message: 'Slug is required' })
  }

  const isAdmin = await isOwner(event)
  const visibilityFilter = isAdmin
    ? ''
    : 'AND (visibility IN ["public", "password"] OR visibility IS NONE)'
  const db = await useDb()
  const sourceResponse = await queryDb(
    db,
    `SELECT id FROM post
     WHERE slug = $slug
       AND status = "published"
       ${visibilityFilter}
     LIMIT 1;`,
    { slug }
  )
  const source = firstRow<{ id?: unknown }>(sourceResponse)
  if (!source?.id) {
    throw createError({ statusCode: 404, message: 'Post not found' })
  }

  const sourceId = recordIdPart(stringifyRecordId(source.id), 'post')
  const relatedResponse = await queryDb(
    db,
    `SELECT out.id AS id, out.slug AS slug, out.title AS title, out.published_at AS published_at, out.visibility AS visibility
     FROM links
     WHERE in = type::record('post', $sourceId)
       AND out.status = "published"
       ${visibilityFilter}
     ORDER BY out.published_at DESC;`,
    { sourceId }
  )

  const posts = queryRows<Record<string, unknown>>(relatedResponse)
    .map<PostListItem>((post) => ({
      id: stringifyRecordId(post.id),
      slug: String(post.slug ?? ''),
      title: String(post.title ?? ''),
      summary: null,
      excerpt: null,
      cover_image: null,
      published_at: post.published_at ? String(post.published_at) : null,
      visibility: normalizeVisibility(post.visibility)
    }))
    .filter((post) => post.id && post.slug && post.title)

  return { posts }
}

function normalizeVisibility(value: unknown): PostVisibility {
  return value === 'private' || value === 'password' ? value : 'public'
}