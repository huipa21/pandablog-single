import { readBoundedJson } from '../../utils/bounded-json'
import { adminPasswordProblem } from '../../utils/admin-password'
import { requireOwner } from '../../utils/auth'
import { recordActivity } from '../../utils/activity'
import { findUserById, setUserPassword, verifyUserPassword } from '../../utils/users'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  const body = await readBoundedJson(event, 8 * 1024)
  const currentPassword = typeof body.current_password === 'string' ? body.current_password : ''
  const newPassword = typeof body.new_password === 'string' ? body.new_password : ''
  const confirmPassword = typeof body.confirm_password === 'string' ? body.confirm_password : ''

  const account = await findUserById(user.id)
  const currentOk = await verifyUserPassword(account, currentPassword)
  if (!currentOk) {
    throw createError({ statusCode: 400, message: 'Current password is incorrect' })
  }

  const passwordError = adminPasswordProblem(newPassword)
  if (passwordError) {
    throw createError({ statusCode: 400, message: passwordError })
  }

  if (newPassword !== confirmPassword) {
    throw createError({ statusCode: 400, message: 'Passwords do not match' })
  }

  await setUserPassword(user.id, newPassword, account!.auth_epoch)
  // Revoke every session, including this caller; no stolen device is preserved.
  await clearUserSession(event)

  recordActivity(event, {
    action: 'auth.password.change',
    resource_type: 'session',
    resource_id: user.id,
    metadata: { username: user.username },
    description: 'User password changed'
  })

  return { ok: true }
})