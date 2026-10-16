import { queryDbRecord, useDb } from '../../../../../utils/db'
import { deletePostVersion } from '../../../../../utils/blocks'
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

  await deletePostVersion(db, `post:${id}`, version)
  return { deleted: true, version }
})