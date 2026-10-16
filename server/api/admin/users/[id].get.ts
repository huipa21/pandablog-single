import { requireOwner } from '../../../utils/auth'
import { assertCanManageTargetUser } from '../../../utils/user-management'
import { findUserById } from '../../../utils/users'

export default defineEventHandler(async (event) => {
  const actor = await requireOwner(event)
  const user = await findUserById(getRouterParam(event, 'id') ?? '')

  if (!user) {
    throw createError({ statusCode: 404, message: 'User not found' })
  }

  assertCanManageTargetUser(actor, user)
  const { password_hash: _passwordHash, auth_epoch: _authEpoch, ...safeUser } = user
  return { user: safeUser }
})