import { queryDb, queryDbRecord, useDb } from '../../../utils/db'
import { buildPostPayload, normalizePost, stringOrNull } from '../../../utils/content'
import { firstRow, recordIdPart } from '../../../utils/surrealResult'
import { requireOwner } from '../../../utils/auth'
import { assertPostSlugAvailable, uniquePostSlug } from '../../../utils/posts'
import { hashPostPassword } from '../../../utils/post-password'
import { readPostTaxonomy, syncPostTaxonomy } from '../../../utils/taxonomy'
import { mediaCascadeVisibilityForPost, mediaReserveReferences, mediaSyncRecordReferences } from '../../../utils/referenceTracker'
import {
  buildDocFromBlocks,
  computeStatsFromBlocks,
  extractBlocksFromDoc,
  loadBlocksForPost,
  readPostRelated,
  syncPostBlocks,
  syncPostRelatedLinks
} from '../../../utils/blocks'
import { syncPostSearchTerms } from '../../../utils/searchTerms'
import type { JsonContent, PostVisibility } from '~/types/content'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  const id = recordIdPart(getRouterParam(event, 'id') ?? '', 'post')
  const body = await readBody<Record<string, unknown>>(event)
  const db = await useDb()

  const existing = await queryDbRecord(db, 'post', id)
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Post not found' })
  }

  const previousPost = normalizePost(existing)
  const previousBlocks = await loadBlocksForPost(db, previousPost.id)
  const previousDoc = buildDocFromBlocks(previousBlocks)

  const merged = { ...existing, ...body }
  const payload = buildPostPayload(merged)

  if (payload.status === 'published' && !payload.title) {
    throw createError({ statusCode: 400, message: 'Title is required' })
  }

  const desiredSlug = String(payload.slug)
  payload.slug = payload.status === 'published'
    ? await assertPostSlugAvailable(db, desiredSlug, `post:${id}`)
    : desiredSlug === previousPost.slug
      ? previousPost.slug
      : await uniquePostSlug(db, desiredSlug, `post:${id}`)
  if (!previousPost.has_versioning && payload.status === 'published') {
    payload.has_versioning = true
  }
  const visibilityUpdate = await resolveVisibilityUpdate(body, existing)
  const clears = cleanOptionalFieldClears(body)

  const statements: string[] = ['UPDATE type::record($table, $id) MERGE $post;']
  if (clears) {
    statements.push(`UPDATE type::record($table, $id) ${clears};`)
  }
  const updateSql = statements.join('\n')

  const params: Record<string, unknown> = {
    table: 'post',
    id,
    post: {
      ...payload,
      ...visibilityUpdate
    }
  }

  await mediaReserveReferences(db, previousPost.id, [payload.cover_image, Object.prototype.hasOwnProperty.call(body, 'content_json') ? parseDoc(body.content_json) : previousDoc], user)
  const response = await queryDb(db, updateSql, params)
  const post = statements.length > 1
    ? firstRow<Record<string, unknown>>(response, statements.length - 1) || firstRow<Record<string, unknown>>(response)
    : firstRow<Record<string, unknown>>(response)

  if (!post) {
    throw createError({ statusCode: 500, message: 'Post was not updated' })
  }

  const normalizedPost = normalizePost(post)
  let blocks = previousBlocks
  let reassembledDoc = previousDoc

  if (Object.prototype.hasOwnProperty.call(body, 'content_json')) {
    const incomingDoc = parseDoc(body.content_json)
    const incomingBlocks = extractBlocksFromDoc(incomingDoc)
    blocks = await syncPostBlocks(db, normalizedPost.id, incomingBlocks, previousBlocks, {
      shouldSnapshot: previousPost.has_versioning === true
    })
    reassembledDoc = buildDocFromBlocks(blocks)
  }

  const stats = computeStatsFromBlocks(blocks)
  if (stats.word_count !== previousPost.word_count || stats.cjk_char_count !== previousPost.cjk_char_count) {
    await queryDb(
      db,
      'UPDATE type::record($table, $id) MERGE { word_count: $word_count, cjk_char_count: $cjk_char_count };',
      { table: 'post', id, ...stats },
      { label: 'post stats update' }
    )
  }
  normalizedPost.word_count = stats.word_count
  normalizedPost.cjk_char_count = stats.cjk_char_count
  await syncPostSearchTerms(db, normalizedPost.id, {
    status: normalizedPost.status,
    title: normalizedPost.title,
    summary: normalizedPost.summary,
    blockTexts: blocks.map((block) => block.text)
  })

  await syncPostTaxonomy(
    db,
    id,
    body.tag_ids,
    body.category_ids,
    body.tag_names,
    body.category_names
  )
  const relatedPosts = Object.prototype.hasOwnProperty.call(body, 'related_post_ids')
    ? await syncPostRelatedLinks(db, normalizedPost.id, body.related_post_ids)
    : await readPostRelated(db, normalizedPost.id)
  const mediaReferences = await mediaSyncRecordReferences(
    db,
    normalizedPost.id,
    [previousPost.cover_image, previousDoc],
    [normalizedPost.cover_image, reassembledDoc]
  )
  if (mediaReferences.changed || normalizedPost.visibility !== previousPost.visibility) {
    await mediaCascadeVisibilityForPost(db, normalizedPost.id, normalizedPost.visibility ?? 'public', [normalizedPost.cover_image, reassembledDoc])
  }

  return {
    ...normalizedPost,
    content_json: reassembledDoc,
    blocks,
    related_post_ids: relatedPosts.map(post => post.id),
    related_posts: relatedPosts,
    ...await readPostTaxonomy(db, id)
  }
})

function cleanOptionalFieldClears(body: Record<string, unknown>) {
  const clearSummary = typeof body.summary === 'string' && body.summary.trim() === ''
  const clearCoverImage = typeof body.cover_image === 'string' && body.cover_image.trim() === ''
  const clearPublishedAt = Object.prototype.hasOwnProperty.call(body, 'status') && body.status !== 'published'
  const clearPasswordHint = Object.prototype.hasOwnProperty.call(body, 'password_hint') && stringOrNull(body.password_hint) === null
  const assignments: string[] = []

  if (clearSummary) assignments.push('summary = NONE')
  if (clearCoverImage) assignments.push('cover_image = NONE')
  if (clearPublishedAt) assignments.push('published_at = NONE')
  if (clearPasswordHint || body.visibility === 'public' || body.visibility === 'private') {
    assignments.push('password_hint = NONE')
  }
  if (body.visibility === 'public' || body.visibility === 'private') {
    assignments.push('password_hash = NONE')
  }

  return assignments.length ? `SET ${assignments.join(', ')}` : ''
}

async function resolveVisibilityUpdate(body: Record<string, unknown>, existing: Record<string, unknown>) {
  const visibility = normalizeVisibility(body.visibility ?? existing.visibility)
  const updates: Record<string, unknown> = { visibility }

  if (visibility !== 'password') {
    return updates
  }

  const currentHash = typeof existing.password_hash === 'string' ? existing.password_hash : null
  const password = typeof body.password === 'string' ? body.password : ''
  if (password.length > 0) {
    updates.password_hash = await hashPostPassword(password)
  } else if (currentHash) {
    updates.password_hash = currentHash
  } else {
    throw createError({ statusCode: 400, message: 'Password is required for password-protected posts' })
  }

  if (Object.prototype.hasOwnProperty.call(body, 'password_hint')) {
    const passwordHint = stringOrNull(body.password_hint)
    if (passwordHint) {
      updates.password_hint = passwordHint
    }
  }

  return updates
}

function normalizeVisibility(value: unknown): PostVisibility {
  if (value === 'private' || value === 'password') return value
  return 'public'
}

function parseDoc(value: unknown): JsonContent | null {
  if (value && typeof value === 'object') return value as JsonContent
  return null
}
