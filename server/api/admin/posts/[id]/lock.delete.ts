import { queryDb, queryDbRecord, useDb } from '../../../../utils/db'
import { firstRow, recordIdPart } from '../../../../utils/surrealResult'
import { requireOwner } from '../../../../utils/auth'
import { assertCanManagePostRecord } from '../../../../utils/permissions'

interface LockRow {
  holder_username?: unknown
}

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  const id = recordIdPart(getRouterParam(event, 'id') ?? '', 'post')
  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid post id' })
  }

  const body: Record<string, unknown> = await readBody<Record<string, unknown>>(event).catch(() => ({}))
  const force = body.force === true
  const db = await useDb()
  const post = await queryDbRecord(db, 'post', id)
  if (!post) {
    throw createError({ statusCode: 404, message: 'Post not found' })
  }
  assertCanManagePostRecord(user, post)

  const lockId = id
  const existingResponse = await queryDb(
    db,
    `SELECT holder_username FROM type::record('edit_lock', $lockId);`,
    { lockId },
    { label: 'post edit lock release read' }
  )
  const existing = firstRow<LockRow>(existingResponse)
  const holder = String(existing?.holder_username ?? '')
  const canForce = user.role === 'superadmin' || user.role === 'admin'

  if (holder && holder !== user.username && !(force && canForce)) {
    throw createError({ statusCode: 409, message: 'Post is locked by another editor' })
  }

  await queryDb(
    db,
    `DELETE type::record('edit_lock', $lockId);`,
    { lockId },
    { label: 'post edit lock release' }
  )

  return { released: true }
})
