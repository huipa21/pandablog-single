import { requireOwner } from '../../utils/auth'
import { findUserById } from '../../utils/users'

export default defineEventHandler(async (event) => {
  const sessionUser = await requireOwner(event)
  const user = await findUserById(sessionUser.id)

  if (!user || !user.active) {
    throw createError({ statusCode: 401, message: 'Authentication required' })
  }

  const { password_hash: _passwordHash, auth_epoch: _authEpoch, ...safeUser } = user
  return { user: safeUser }
})