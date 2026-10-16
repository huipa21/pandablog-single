import { reserveAuthAttempt } from '../../../../utils/rate-limit'
import { requestAbortSignal } from '../../../../utils/request-abort'
import { readBoundedJson } from '../../../../utils/bounded-json'
import { recordActivity } from '../../../../utils/activity'
import { alertDetailsFromEvent, dispatchSecurityAlert } from '../../../../utils/notify/security-alert'
import { clearMfaEnroll, getMfaEnrollSecret, resolveMfaActor } from '../../../../utils/mfa/session'
import { enableUserMfa, getUserMfaState } from '../../../../utils/mfa/store'
import { encryptMfaSecret } from '../../../../utils/mfa/secret-crypto'
import { generateBackupCodes, verifyTotpToken } from '../../../../utils/mfa/totp'
import { issueTrustedDevice, resolveTrustedDeviceContext } from '../../../../utils/mfa/trusted-devices'
import { findUserById, toSessionUser, touchUserLogin } from '../../../../utils/users'

// Confirm enrollment: verify a code from the pending secret, then persist the
// encrypted secret and hashed backup codes. The plaintext backup codes are
// returned exactly once. When enrollment was forced at login (no prior
// session), a full authenticated session is issued on success.
export default defineEventHandler(async (event) => {
  const body = await readBoundedJson(event, 8 * 1024)
  if (typeof body.code !== 'string' || body.code.length > 64 || (body.trustDevice !== undefined && typeof body.trustDevice !== 'boolean')) throw createError({statusCode: 400, message: 'Invalid MFA input'})
  const code = body.code.trim()

  const { userId, finalize, authEpoch } = await resolveMfaActor(event)
  const rate = await reserveAuthAttempt('mfa', getRequestIP(event, {xForwardedFor: true}) ?? 'noip', userId)
  if (!rate.allowed) {setResponseHeader(event, 'Retry-After', rate.retryAfterSec); throw createError({statusCode: 429, message: 'Too many MFA attempts'})}

  const existing = await getUserMfaState(userId)
  if (existing?.enabled) {
    throw createError({ statusCode: 409, message: 'Multi-factor authentication is already enabled' })
  }

  const secret = await getMfaEnrollSecret(event)
  if (!secret) {
    throw createError({ statusCode: 400, message: 'Enrollment has expired. Start again.' })
  }

  const step = await verifyTotpToken(secret, code)
  if (step === null) {
    throw createError({ statusCode: 400, message: 'Invalid verification code' })
  }

  let user = await findUserById(userId)
  if (!user?.active) {
    throw createError({ statusCode: 404, message: 'User not found' })
  }

  const backupCodes = await generateBackupCodes(requestAbortSignal(event))
  const enabledEpoch = await enableUserMfa(userId, {
    authEpoch,
    initialStep: step,
    encryptedSecret: await encryptMfaSecret(secret),
    backupCodeHashes: backupCodes.hashes
  })

  recordActivity(event, {
    action: 'auth.mfa.enabled',
    resource_type: 'session',
    resource_id: user.id,
    metadata: { username: user.username },
    description: 'Multi-factor authentication enabled'
  })

  user = await findUserById(userId)
  if (!user?.active || user.auth_epoch !== enabledEpoch) throw createError({statusCode: 401, message: 'Authentication required'})
  if (finalize) {
    // Forced enrollment: finalize the login that was held pending.
    const sessionUser = toSessionUser(user)
    await replaceUserSession(event, {
      secure: {authEpoch: user.auth_epoch, authenticatedAt: new Date().toISOString()},
      user: sessionUser,
      loggedInAt: new Date().toISOString()
    })
    if (body?.trustDevice === true) {
      try {
        await issueTrustedDevice(event, sessionUser.id, await resolveTrustedDeviceContext(event), user.auth_epoch)
      } catch (error) {
        console.warn('[auth.mfa.activate] trusted device issue failed; login continues', error)
      }
    }
    await touchUserLogin(sessionUser.id)

    recordActivity(event, {
      action: 'auth.login',
      resource_type: 'session',
      resource_id: sessionUser.id,
      metadata: { username: sessionUser.username, mfa: true, trusted_device: body?.trustDevice === true },
      description: 'User signed in'
    })
    dispatchSecurityAlert('login.success', alertDetailsFromEvent(event, {
      username: sessionUser.username,
      reason: 'MFA enrolled'
    }))

    return { enabled: true, backup_codes: backupCodes.plain, user: sessionUser }
  }

  // Self-service enrollment: keep the current session, drop the pending secret.
  await clearMfaEnroll(event)
  await clearUserSession(event) // MFA security change revokes this session too

  return { enabled: true, backup_codes: backupCodes.plain }
})
