import { reserveAuthAttempt } from '../../../../utils/rate-limit'
import { readBoundedJson } from '../../../../utils/bounded-json'
import { recordActivity } from '../../../../utils/activity'
import { requireOwner } from '../../../../utils/auth'
import { disableUserMfa, getUserMfaState } from '../../../../utils/mfa/store'
import { consumeMfaFactor } from '../../../../utils/mfa/factor'
import { requestAbortSignal } from '../../../../utils/request-abort'
import { revokeAllTrustedDevices } from '../../../../utils/mfa/trusted-devices'
import { findUserById, verifyUserPassword } from '../../../../utils/users'

// Disable MFA for the current user. Requires re-entering the account password
// AND a current authenticator code (or an unused backup code) so a hijacked
// session alone cannot turn off the second factor.
export default defineEventHandler(async (event) => {
  const sessionUser = await requireOwner(event)
  const body = await readBoundedJson(event, 8 * 1024)
  if (typeof body.password !== 'string' || body.password.length > 200 || typeof body.code !== 'string' || body.code.length > 64) throw createError({statusCode: 400, message: 'Invalid MFA input'})
  const password = body.password
  const code = typeof body.code === 'string' && body.code.length <= 64 ? body.code.trim() : ''
  const rate = await reserveAuthAttempt('mfa', getRequestIP(event, {xForwardedFor: true}) ?? 'noip', sessionUser.id)
  if (!rate.allowed) {setResponseHeader(event, 'Retry-After', rate.retryAfterSec); throw createError({statusCode: 429, message: 'Too many MFA attempts'})}

  const state = await getUserMfaState(sessionUser.id)
  if (!state?.enabled) {
    throw createError({ statusCode: 409, message: 'Multi-factor authentication is not enabled' })
  }

  const account = await findUserById(sessionUser.id)
  if (!account || !await verifyUserPassword(account, password, requestAbortSignal(event))) {
    throw createError({ statusCode: 401, message: 'Incorrect password' })
  }

  const factor = await consumeMfaFactor(sessionUser.id, account.auth_epoch, state, code, requestAbortSignal(event))
  if (!factor.ok) throw createError({statusCode: 400, message: 'Invalid verification code'})

  await disableUserMfa(sessionUser.id, account.auth_epoch)
  await revokeAllTrustedDevices(event, sessionUser.id)
  await clearUserSession(event)

  recordActivity(event, {
    action: 'auth.mfa.disabled',
    resource_type: 'session',
    resource_id: sessionUser.id,
    metadata: { username: sessionUser.username },
    description: 'Multi-factor authentication disabled'
  })

  return { enabled: false }
})
