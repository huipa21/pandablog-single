import { queryDb, queryDbRecord, useDb } from '../../../../../../utils/db'
import { buildDocFromBlocks, computeStatsFromBlocks, loadBlocksForPost, restorePostVersion } from '../../../../../../utils/blocks'
import { recordIdPart } from '../../../../../../utils/surrealResult'
import { requireOwner } from '../../../../../../utils/auth'
import { normalizePost } from '../../../../../../utils/content'
import { syncPostSearchTerms } from '../../../../../../utils/searchTerms'
import { mediaCascadeVisibilityForPost } from '../../../../../../utils/referenceTracker'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  const id = recordIdPart(getRouterParam(event, 'id') ?? '', 'post')
  const version = String(getRouterParam(event, 'version') ?? '').trim()
  if (!version) {
    throw createError({ statusCode: 400, message: 'Version is required' })
  }

  const db = await useDb()
  const post = await queryDbRecord(db, 'post', id)
  if (!post) {
    throw createError({ statusCode: 404, message: 'Post not found' })
  }

  const previousBlocks = await loadBlocksForPost(db, `post:${id}`)
  const blocks = await restorePostVersion(db, `post:${id}`, version, previousBlocks, user)
  const stats = computeStatsFromBlocks(blocks)
  await queryDb(
    db,
    'UPDATE type::record($table, $id) MERGE { word_count: $word_count, cjk_char_count: $cjk_char_count, updated_at: time::now() };',
    { table: 'post', id, ...stats },
    { label: 'post version restore stats' }
  )

  const updated = await queryDbRecord(db, 'post', id)
  const normalized = normalizePost(updated ?? post)
  normalized.word_count = stats.word_count
  normalized.cjk_char_count = stats.cjk_char_count
  await syncPostSearchTerms(db, normalized.id, {
    status: normalized.status,
    title: normalized.title,
    summary: normalized.summary,
    blockTexts: blocks.map((block) => block.text)
  })

  await mediaCascadeVisibilityForPost(db, normalized.id, normalized.visibility ?? 'public', [normalized.cover_image, buildDocFromBlocks(blocks)])
  return {
    ...normalized,
    content_json: buildDocFromBlocks(blocks),
    blocks,
    restored_version: version
  }
})