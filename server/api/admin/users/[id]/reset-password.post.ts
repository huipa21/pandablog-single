import { readBoundedJson } from '../../../../utils/bounded-json'
import { requireOwner } from '../../../../utils/auth'
import { assertCanManageTargetUser, assertNotSelf } from '../../../../utils/user-management'
import { findUserById, setUserPassword } from '../../../../utils/users'

export default defineEventHandler(async (event) => {
  const actor = await requireOwner(event)
  const target = await findUserById(getRouterParam(event, 'id') ?? '')
  if (!target) {
    throw createError({ statusCode: 404, message: 'User not found' })
  }

  assertCanManageTargetUser(actor, target)
  if (target.id === 'users:admin') {
    throw createError({ statusCode: 400, message: 'Use change password to update the admin password' })
  }
  assertNotSelf(actor, target, 'Use change password to update your own password')

  const body = await readBoundedJson(event, 8 * 1024)
  if (typeof body.password !== 'string' || body.password.length > 200) throw createError({statusCode: 400, message: 'Invalid password input'})
  await setUserPassword(target.id, body.password)

  return { ok: true }
})