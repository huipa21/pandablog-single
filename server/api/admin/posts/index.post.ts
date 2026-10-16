import { randomUUID } from 'node:crypto'
import { queryDb, useDb } from '../../../utils/db'
import { buildPostPayload, normalizePost, stringOrNull } from '../../../utils/content'
import { firstRow, recordIdPart, stringifyRecordId } from '../../../utils/surrealResult'
import { requireOwner } from '../../../utils/auth'
import { assertPostSlugAvailable, uniquePostSlug } from '../../../utils/posts'
import { readPostTaxonomy, syncPostTaxonomy } from '../../../utils/taxonomy'
import { hashPostPassword } from '../../../utils/post-password'
import { mediaCascadeVisibilityForPost, mediaReserveReferences, mediaSyncRecordReferences } from '../../../utils/referenceTracker'
import { buildDocFromBlocks, computeStatsFromBlocks, extractBlocksFromDoc, syncPostBlocks, syncPostRelatedLinks } from '../../../utils/blocks'
import { syncPostSearchTerms } from '../../../utils/searchTerms'
import type { JsonContent, PostVisibility } from '~/types/content'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  const body = await readBody<Record<string, unknown>>(event)
  const payload = buildPostPayload(body)
  const visibility = normalizeVisibility(body.visibility)
  const password = typeof body.password === 'string' ? body.password : ''

  if (payload.status === 'published' && !payload.title) {
    throw createError({ statusCode: 400, message: 'Title is required' })
  }

  const visibilityUpdates: Record<string, unknown> = { visibility }
  if (visibility === 'password') {
    const passwordHint = stringOrNull(body.password_hint)
    if (passwordHint) {
      visibilityUpdates.password_hint = passwordHint
    }
    visibilityUpdates.password_hash = await hashPostPassword(password)
  }

  const db = await useDb()
  payload.slug = payload.status === 'published'
    ? await assertPostSlugAvailable(db, String(payload.slug))
    : await uniquePostSlug(db, String(payload.slug))

  const reservedPostId = randomUUID()
  await mediaReserveReferences(db, `post:${reservedPostId}`, [payload.cover_image, parseDoc(body.content_json)], user)
  const response = await queryDb(
    db,
    "CREATE type::record('post', $reservedPostId) CONTENT $post;",
    {
      reservedPostId,
      post: {
        ...payload,
        ...visibilityUpdates,
        has_versioning: payload.status === 'published',
        created_at: new Date(),
        view_count: 0
      }
    }
  )
  const post = firstRow<Record<string, unknown>>(response)
  if (!post) {
    throw createError({ statusCode: 500, message: 'Post was not created' })
  }

  const postId = recordIdPart(stringifyRecordId(post.id), 'post')

  const normalizedPost = normalizePost(post)
  const incomingDoc = parseDoc(body.content_json)
  const incomingBlocks = extractBlocksFromDoc(incomingDoc)
  const blocks = await syncPostBlocks(db, normalizedPost.id, incomingBlocks)
  const relatedPosts = await syncPostRelatedLinks(db, normalizedPost.id, body.related_post_ids)
  const reassembledDoc = buildDocFromBlocks(blocks)
  const stats = computeStatsFromBlocks(blocks)

  await queryDb(
    db,
    'UPDATE type::record($table, $id) MERGE { word_count: $word_count, cjk_char_count: $cjk_char_count };',
    { table: 'post', id: postId, ...stats },
    { label: 'post stats create' }
  )
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
    normalizedPost.id,
    body.tag_ids,
    body.category_ids,
    body.tag_names,
    body.category_names
  )
  await mediaSyncRecordReferences(db, normalizedPost.id, [], [normalizedPost.cover_image, reassembledDoc])
  await mediaCascadeVisibilityForPost(db, normalizedPost.id, normalizedPost.visibility ?? 'public', [normalizedPost.cover_image, reassembledDoc])

  return {
    ...normalizedPost,
    content_json: reassembledDoc,
    blocks,
    related_post_ids: relatedPosts.map(post => post.id),
    related_posts: relatedPosts,
    ...await readPostTaxonomy(db, normalizedPost.id)
  }
})

function normalizeVisibility(value: unknown): PostVisibility {
  if (value === 'private' || value === 'password') return value
  return 'public'
}

function parseDoc(value: unknown): JsonContent | null {
  if (value && typeof value === 'object') return value as JsonContent
  return null
}
