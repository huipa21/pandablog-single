import { queryDbRecord, useDb } from '../../../../../utils/db'
import { buildDocFromBlocks, loadBlocksForVersion, loadVersionsForPost } from '../../../../../utils/blocks'
import { recordIdPart } from '../../../../../utils/surrealResult'
import { requireOwner } from '../../../../../utils/auth'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
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

  const [blocks, versions] = await Promise.all([
    loadBlocksForVersion(db, `post:${id}`, version),
    loadVersionsForPost(db, `post:${id}`)
  ])
  const meta = versions.find((item) => item.version === version) ?? null
  if (version !== 'current' && !meta) {
    throw createError({ statusCode: 404, message: 'Version not found' })
  }

  return {
    version,
    meta,
    content_json: buildDocFromBlocks(blocks),
    blocks
  }
})