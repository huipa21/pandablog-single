import { readBoundedJson } from '../../../utils/bounded-json'
import { recordActivity } from '../../../utils/activity'
import { requestAbortSignal } from '../../../utils/request-abort'
import { reserveAuthAttempt } from '../../../utils/rate-limit'
import { alertDetailsFromEvent, dispatchSecurityAlert } from '../../../utils/notify/security-alert'
import { getMfaPending } from '../../../utils/mfa/session'
import { getUserMfaState } from '../../../utils/mfa/store'
import { consumeMfaFactor } from '../../../utils/mfa/factor'
import { issueTrustedDevice, rebindCurrentTrustedDevice, resolveTrustedDeviceContext } from '../../../utils/mfa/trusted-devices'
import { getRuntimeFlags } from '../../../utils/settings'
import { findUserById, toSessionUser, touchUserLogin } from '../../../utils/users'

// Second step of a two-step login: verify a TOTP code (or an unused backup
// code) against the account named by the short-lived `verify` pending state,
// then issue the full authenticated session. Rate limited per IP+user so a
// pending token cannot be brute forced.
export default defineEventHandler(async (event) => {
  const body = await readBoundedJson(event, 8 * 1024)
  if (typeof body?.code !== 'string' || body.code.length > 64 || (body.trustDevice !== undefined && typeof body.trustDevice !== 'boolean')) throw createError({statusCode: 400, message: 'Invalid MFA code'})
  const code = body.code.trim()

  const pending = await getMfaPending(event)
  if (!pending || pending.mode !== 'verify') {
    throw createError({ statusCode: 401, message: 'No pending login. Sign in again.' })
  }

  const ip = getRequestIP(event, { xForwardedFor: getRuntimeFlags().trust_proxy_headers }) ?? 'noip'
  const rate = await reserveAuthAttempt('mfa', ip, pending.userId)
  if (!rate.allowed) {
    setResponseHeader(event, 'Retry-After', rate.retryAfterSec)
    throw createError({ statusCode: 429, message: `Too many attempts. Try again in ${rate.retryAfterSec}s.` })
  }

  const account = await findUserById(pending.userId)
  const state = await getUserMfaState(pending.userId)
  if (!account || !account.active || account.auth_epoch !== pending.authEpoch || !state?.enabled || !state.secret) {
    await clearUserSession(event)
    throw createError({ statusCode: 401, message: 'No pending login. Sign in again.' })
  }

  const {ok, usedBackupCode} = await consumeMfaFactor(pending.userId, pending.authEpoch!, state, code, requestAbortSignal(event))

  if (!ok) {
    recordActivity(event, {
      action: 'auth.mfa.failed',
      resource_type: 'session',
      resource_id: account.id,
      metadata: { username: account.username },
      description: 'Failed multi-factor verification'
    })
    dispatchSecurityAlert('login.failed', alertDetailsFromEvent(event, {
      username: account.username,
      reason: 'Invalid multi-factor code'
    }))
    throw createError({ statusCode: 400, message: 'Invalid verification code' })
  }

  const user = toSessionUser(account)
  const trustedContext = await resolveTrustedDeviceContext(event)
  await replaceUserSession(event, {
    secure: {authEpoch: account.auth_epoch, authenticatedAt: new Date().toISOString()},
    user,
    loggedInAt: new Date().toISOString()
  })
  let reboundTrustedDevice = false
  try {
    reboundTrustedDevice = await rebindCurrentTrustedDevice(event, user.id, trustedContext)
    if (!reboundTrustedDevice && body?.trustDevice === true) {
      await issueTrustedDevice(event, user.id, trustedContext, account.auth_epoch)
    }
  } catch (error) {
    console.warn('[auth.mfa] trusted device update failed; login continues', error)
  }
  await touchUserLogin(user.id)

  recordActivity(event, {
    action: 'auth.login',
    resource_type: 'session',
    resource_id: user.id,
    metadata: { username: user.username, mfa: true, backup_code: usedBackupCode, trusted_device: body?.trustDevice === true || reboundTrustedDevice },
    description: 'User signed in'
  })
  dispatchSecurityAlert('login.success', alertDetailsFromEvent(event, {
    username: user.username,
    reason: usedBackupCode ? 'MFA backup code' : 'MFA'
  }))

  return { user, backup_codes_remaining: usedBackupCode ? state.backupCodes.length - 1 : state.backupCodes.length }
})
