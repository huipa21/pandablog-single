import { requireOwner } from '../../../utils/auth'
import { queryDb, useDb } from '../../../utils/db'
import { firstRow, recordIdPart } from '../../../utils/surrealResult'
import { assertCanManageTargetUser, assertNotSelf } from '../../../utils/user-management'
import { deleteUser, findUserById } from '../../../utils/users'

export default defineEventHandler(async (event) => {
  const actor = await requireOwner(event)
  const target = await findUserById(getRouterParam(event, 'id') ?? '')
  if (!target) {
    throw createError({ statusCode: 404, message: 'User not found' })
  }

  assertCanManageTargetUser(actor, target)
  assertNotSelf(actor, target, 'You cannot delete yourself')
  if (target.id === 'users:admin') {
    throw createError({ statusCode: 400, message: 'The seed admin cannot be deleted' })
  }

  const body = await readBody<{ reassign_to?: string }>(event).catch((): { reassign_to?: string } => ({}))
  const reassignTo = String(body.reassign_to || getQuery(event).reassign_to || '')
  const db = await useDb()
  const sourceId = recordIdPart(target.id, 'users')
  const ownedPostsResponse = await queryDb(
    db,
    `SELECT count() AS total FROM post
     WHERE author = type::record($userTable, $sourceId)
        OR (author IS NONE AND author_username = $sourceUsername)
     GROUP ALL;`,
    { userTable: 'users', sourceId, sourceUsername: target.username }
  )
  const ownedPosts = Number(firstRow<{ total?: number }>(ownedPostsResponse)?.total ?? 0)

  if (ownedPosts > 0) {
    if (!reassignTo) {
      throw createError({ statusCode: 409, message: 'Reassign this user\'s posts before deleting the account' })
    }

    const replacement = await findUserById(reassignTo)
    if (!replacement?.active) {
      throw createError({ statusCode: 400, message: 'Replacement user not found or inactive' })
    }
    assertCanManageTargetUser(actor, replacement)

    await queryDb(
      db,
      `UPDATE post SET
        author = type::record($userTable, $replacementId),
        author_username = $replacementUsername,
        updated_at = time::now()
       WHERE author = type::record($userTable, $sourceId)
          OR (author IS NONE AND author_username = $sourceUsername);`,
      {
        userTable: 'users',
        sourceId,
        sourceUsername: target.username,
        replacementId: recordIdPart(replacement.id, 'users'),
        replacementUsername: replacement.username
      }
    )
  }

  await deleteUser(target.id)
  return { ok: true }
})