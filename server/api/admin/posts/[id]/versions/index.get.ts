import { queryDbRecord, useDb } from '../../../../../utils/db'
import { normalizePost } from '../../../../../utils/content'
import { recordIdPart } from '../../../../../utils/surrealResult'
import { requireOwner } from '../../../../../utils/auth'
import { loadVersionsForPost } from '../../../../../utils/blocks'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const id = recordIdPart(getRouterParam(event, 'id') ?? '', 'post')
  const db = await useDb()
  const post = await queryDbRecord(db, 'post', id)
  if (!post) {
    throw createError({ statusCode: 404, message: 'Post not found' })
  }

  return {
    post_id: normalizePost(post).id,
    versions: await loadVersionsForPost(db, `post:${id}`)
  }
})