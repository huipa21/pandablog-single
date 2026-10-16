import type { H3Event } from 'h3'
import { queryDb, useDb } from '../../utils/db'
import { firstRow, queryRows, recordIdPart, stringifyRecordId } from '../../utils/surrealResult'
import { isOwner } from '../../utils/auth'
import { PUBLIC_LIST_CACHE_SECONDS, publicCacheKey, shouldBypassPublicCache } from '../../utils/public-cache'
import type { PostListItem, PostVisibility } from '~/types/content'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Vary', 'Cookie')

  if (await shouldBypassPublicCache(event)) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    return await handlePostList(event)
  }

  return await cachedPostListHandler(event)
})

const cachedPostListHandler = defineCachedEventHandler(handlePostList, {
  name: 'posts-index-public-v1',
  maxAge: PUBLIC_LIST_CACHE_SECONDS,
  staleMaxAge: PUBLIC_LIST_CACHE_SECONDS * 2,
  swr: true,
  varies: ['cookie'],
  getKey: event => publicCacheKey(getPostListCacheKey(event))
})

async function handlePostList(event: H3Event) {
  setResponseHeader(event, 'Vary', 'Cookie')

  const query = getQuery(event)
  const limit = Math.min(Number(query.limit ?? 20), 100)
  const start = Math.max(Number(query.start ?? 0), 0)
  const tag = String(query.tag ?? '').trim()
  const category = String(query.category ?? '').trim()
  const isAdmin = await isOwner(event)

  const visibilityFilter = isAdmin
    ? ''
    : 'AND (visibility IN ["public", "password"] OR visibility IS NONE)'
  const db = await useDb()
  const filteredPostIds = await resolveFilteredPostIds(db, { tag, category })

  if (filteredPostIds && filteredPostIds.length === 0) {
    return { posts: [], total: 0, limit, start }
  }

  const taxonomyFilter = filteredPostIds ? 'AND id IN $postIds' : ''
  const response = await queryDb(
    db,
    `SELECT id, slug, title, summary, cover_image, published_at, visibility, view_count, word_count, cjk_char_count
     FROM post
     WHERE status = "published" ${visibilityFilter} ${taxonomyFilter}
     ORDER BY published_at DESC, id DESC
     LIMIT $limit START $start;
     SELECT count() AS total FROM post WHERE status = "published" ${visibilityFilter} ${taxonomyFilter} GROUP ALL;`,
    { limit, start, postIds: filteredPostIds ?? [] }
  )
  const postRows = queryRows<Record<string, unknown>>(response, 0)
  const postIds = postRows.map((post) => post.id).filter(Boolean)
  const categoriesByPostId = await loadCategoriesForPosts(db, postIds)
  const excerptPostIds = postRows
    .filter((post) => !hasSummary(post.summary))
    .map((post) => post.id)
    .filter(Boolean)
  const excerptsByPostId = await loadExcerptsForPosts(db, excerptPostIds)
  const posts = postRows.map<PostListItem>((post) => {
    const postId = stringifyRecordId(post.id)
    const summary = hasSummary(post.summary) ? String(post.summary).trim() : null

    return {
      id: postId,
      slug: String(post.slug ?? ''),
      title: String(post.title ?? ''),
      summary,
      excerpt: summary ? null : excerptsByPostId.get(postId) ?? null,
      cover_image: post.cover_image === undefined ? null : post.cover_image as string | null,
      published_at: post.published_at ? String(post.published_at) : null,
      view_count: Number(post.view_count ?? 0),
      word_count: Number(post.word_count ?? 0),
      cjk_char_count: Number(post.cjk_char_count ?? 0),
      visibility: normalizeVisibility(post.visibility),
      categories: categoriesByPostId.get(postId) ?? []
    }
  })
  const count = firstRow<{ total?: number }>(response, 1)

  return {
    posts,
    total: Number(count?.total ?? posts.length),
    limit,
    start
  }
}

function getPostListCacheKey(event: H3Event) {
  const query = getQuery(event)
  const parts = Object.entries(query)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value ?? '')}`)

  return `posts-index:${parts.join('&') || 'default'}`
}

function normalizeVisibility(value: unknown): PostVisibility {
  return value === 'private' || value === 'password' ? value : 'public'
}

function hasSummary(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

async function loadCategoriesForPosts(db: Awaited<ReturnType<typeof useDb>>, postIds: unknown[]) {
  const categoriesByPostId = new Map<string, Array<{ name: string, slug: string }>>()

  if (!postIds.length) {
    return categoriesByPostId
  }

  const response = await queryDb(
    db,
    `SELECT in AS post_id, out.name AS name, out.slug AS slug
     FROM categorized_as
     WHERE in IN $postIds
     FETCH out;`,
    { postIds }
  )

  for (const row of queryRows<Record<string, unknown>>(response)) {
    const postId = stringifyRecordId(row.post_id)
    const name = String(row.name ?? '').trim()
    const slug = String(row.slug ?? '').trim()

    if (!name || !slug) {
      continue
    }

    const categories = categoriesByPostId.get(postId) ?? []
    categories.push({ name, slug })
    categoriesByPostId.set(postId, categories)
  }

  return categoriesByPostId
}

async function loadExcerptsForPosts(db: Awaited<ReturnType<typeof useDb>>, postIds: unknown[]) {
  const textByPostId = new Map<string, string[]>()

  if (!postIds.length) {
    return new Map<string, string>()
  }

  const response = await queryDb(
    db,
    `SELECT in AS version_id, out.text AS text, seq
     FROM has_blocks
     WHERE in IN $versionIds
     ORDER BY seq ASC
     FETCH out;`,
    { versionIds: postIds.map((postId) => `versions:${recordIdPart(stringifyRecordId(postId), 'post')}__current`) }
  )

  for (const row of queryRows<Record<string, unknown>>(response)) {
    const versionId = stringifyRecordId(row.version_id)
    const postId = `post:${recordIdPart(versionId, 'versions').replace(/__current$/, '')}`
    const text = String(row.text ?? '').trim()

    if (!text) {
      continue
    }

    const parts = textByPostId.get(postId) ?? []
    parts.push(text)
    textByPostId.set(postId, parts)
  }

  return new Map(Array.from(textByPostId.entries()).map(([postId, parts]) => [postId, createExcerpt(parts.join(' '))]))
}

function createExcerpt(text: string) {
  const normalized = text.replace(/\s+/g, ' ').trim()

  if (normalized.length <= 220) {
    return normalized
  }

  const clipped = normalized.slice(0, 220).replace(/\s+\S*$/, '').trimEnd()
  return `${clipped || normalized.slice(0, 220).trimEnd()}...`
}

async function resolveFilteredPostIds(db: Awaited<ReturnType<typeof useDb>>, filters: { tag: string, category: string }) {
  const groups: unknown[][] = []

  if (filters.tag) {
    groups.push(await relationPostIds(db, 'tag', 'tagged', filters.tag))
  }

  if (filters.category) {
    groups.push(await relationPostIds(db, 'category', 'categorized_as', filters.category))
  }

  if (!groups.length) {
    return null
  }

  const maps = groups.map((group) => new Map(group.map((id) => [stringifyRecordId(id), id])))
  const [firstMap] = maps
  if (!firstMap) {
    return []
  }

  return Array.from(firstMap.keys())
    .filter((key) => maps.every((map) => map.has(key)))
    .map((key) => firstMap.get(key))
}

async function relationPostIds(db: Awaited<ReturnType<typeof useDb>>, table: 'tag' | 'category', relation: 'tagged' | 'categorized_as', slug: string) {
  const lookup = await queryDb(db, `SELECT id FROM ${table} WHERE slug = $slug LIMIT 1;`, { slug })
  const item = firstRow<{ id: unknown }>(lookup)

  if (!item) {
    return []
  }

  const response = await queryDb(db, `SELECT in FROM ${relation} WHERE out = $id;`, { id: item.id })
  return queryRows<Record<string, unknown>>(response).map((row) => row.in).filter(Boolean)
}