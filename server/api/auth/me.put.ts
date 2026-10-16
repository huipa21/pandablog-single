import { readBoundedJson } from '../../utils/bounded-json'
import { requireOwner } from '../../utils/auth'
import { queryDb, useDb } from '../../utils/db'
import { mediaReadFileByHash } from '../../utils/mediaLibrary'
import { mediaRecordVisibleToUser } from '../../utils/mediaPermissions'
import { mediaScope } from '../../utils/media-query'
import { queryRows } from '../../utils/surrealResult'
import { recordIdPart } from '../../utils/surrealResult'
import { findUserById, toSessionUser, updateUser } from '../../utils/users'

export default defineEventHandler(async (event) => {
  const sessionUser = await requireOwner(event)
  const body = await readBoundedJson(event, 8 * 1024)
  for (const [field, limit] of [['display_name', 120], ['email', 254], ['avatar', 100]] as const) {
    const value = body[field]
    if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > limit)) throw createError({statusCode: 400, message: 'Invalid profile input'})
  }
  const existing = await findUserById(sessionUser.id)

  if (!existing || !existing.active) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const avatar = body.avatar === undefined ? undefined : typeof body.avatar === 'string' ? body.avatar : null
  if (avatar) {
    await assertAvatarMediaSelectable(sessionUser, avatar)
  }

  const user = await updateUser(existing.id, {
    display_name: body.display_name === undefined ? undefined : typeof body.display_name === 'string' ? body.display_name : null,
    email: body.email === undefined ? undefined : typeof body.email === 'string' ? body.email : null,
    avatar
  })

  await setUserSession(event, {
    user: toSessionUser(user),
    loggedInAt: new Date().toISOString()
  })

  return { user }
})

async function assertAvatarMediaSelectable(user: Awaited<ReturnType<typeof requireOwner>>, avatar: string) {
  const hash = recordIdPart(avatar, 'files')
  if (!/^[a-f0-9]{64}$/i.test(hash)) {
    throw createError({ statusCode: 400, message: 'Avatar must reference an existing media record' })
  }

  const db = await useDb()
  const file = await mediaReadFileByHash(db, hash)
  if (!file) {
    throw createError({ statusCode: 400, message: 'Avatar media was not found' })
  }
  if (!mediaRecordVisibleToUser(file, user)) {
    throw createError({ statusCode: 403, message: 'You cannot use that media as your avatar' })
  }

  if (file.visibility !== 'public') {
    const scope = mediaScope(user, true)
    const updated = await queryDb(db, `UPDATE type::record($table, $id) SET visibility = $visibility, updated_at = time::now() WHERE ${scope.where} RETURN id;`, {
      ...scope.params, table: 'files', id: hash, visibility: 'public'
    })
    if (!queryRows(updated).length) throw createError({statusCode: 409, message: 'Avatar media unavailable'})
  }
}