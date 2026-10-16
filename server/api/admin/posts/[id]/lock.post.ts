import { queryDb, queryDbRecord, useDb } from '../../../../utils/db'
import { firstRow, recordIdPart } from '../../../../utils/surrealResult'
import { requireOwner } from '../../../../utils/auth'
import { assertCanManagePostRecord } from '../../../../utils/permissions'

const LOCK_STALE_MS = 90_000

interface LockRow {
  holder_username?: unknown
  holder_display?: unknown
  heartbeat_at?: unknown
}

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  const id = recordIdPart(getRouterParam(event, 'id') ?? '', 'post')
  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid post id' })
  }

  const db = await useDb()
  const post = await queryDbRecord(db, 'post', id)
  if (!post) {
    throw createError({ statusCode: 404, message: 'Post not found' })
  }
  assertCanManagePostRecord(user, post)

  const lockId = id
  const existingResponse = await queryDb(
    db,
    `SELECT holder_username, holder_display, heartbeat_at FROM type::record('edit_lock', $lockId);`,
    { lockId },
    { label: 'post edit lock read' }
  )
  const existing = firstRow<LockRow>(existingResponse)
  const holder = String(existing?.holder_username ?? '')
  const fresh = isFresh(existing?.heartbeat_at)

  if (existing && holder && holder !== user.username && fresh) {
    return {
      can_edit: false,
      locked: true,
      holder_username: holder,
      holder_display: existing.holder_display ? String(existing.holder_display) : holder
    }
  }

  const displayName = typeof user.display_name === 'string' && user.display_name.trim() ? user.display_name.trim() : user.username
  await queryDb(
    db,
    `UPSERT type::record('edit_lock', $lockId) CONTENT {
       post: type::record('post', $postId),
       holder_username: $username,
       holder_display: $displayName,
       acquired_at: time::now(),
       heartbeat_at: time::now()
     };`,
    { lockId, postId: id, username: user.username, displayName },
    { label: 'post edit lock acquire' }
  )

  return {
    can_edit: true,
    locked: false,
    holder_username: user.username,
    holder_display: displayName
  }
})

function isFresh(value: unknown): boolean {
  if (!value) return false
  const timestamp = new Date(String(value)).getTime()
  return Number.isFinite(timestamp) && Date.now() - timestamp < LOCK_STALE_MS
}
