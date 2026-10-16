import { readBoundedJson } from '../../utils/bounded-json'
import { recordActivity } from '../../utils/activity'
import { requestAbortSignal } from '../../utils/request-abort'
import { reserveAuthAttempt } from '../../utils/rate-limit'
import { alertDetailsFromEvent, dispatchSecurityAlert } from '../../utils/notify/security-alert'
import { setMfaPending } from '../../utils/mfa/session'
import { getUserMfaState } from '../../utils/mfa/store'
import { findMatchingTrustedDevice, refreshTrustedDevice, resolveTrustedDeviceContext, trustedDeviceContextMatches } from '../../utils/mfa/trusted-devices'
import { getSecuritySettings, getRuntimeFlags, isSetupCompleted } from '../../utils/settings'
import { findUserByUsername, toSessionUser, touchUserLogin, verifyUserPassword } from '../../utils/users'


export default defineEventHandler(async (event) => {
  const body = await readBoundedJson(event, 8 * 1024)
  if (typeof body?.username !== 'string' || body.username.length > 64 || typeof body.password !== 'string' || body.password.length > 200) {
    throw createError({statusCode: 400, message: 'Invalid credentials'})
  }
  const username = body.username.trim()
  const password = body.password
  const runtimeFlags = getRuntimeFlags()

  // ---- IP resolution -------------------------------------------------------
  const ip = getRequestIP(event, { xForwardedFor: runtimeFlags.trust_proxy_headers }) ?? null

  if (!ip) {
    if (runtimeFlags.trust_proxy_headers) {
      throw createError({
        statusCode: 400,
        message: 'Could not resolve client IP. Check reverse proxy configuration.'
      })
    }
    // Missing development IP shares a finite fallback budget; never skip admission.
  }

  // Reserve BOTH dimensions before DB/password/MFA work. Final successes do
  // not clear fixed windows; a correct first factor is not completed MFA.
  const rate = await reserveAuthAttempt('login', ip ?? 'noip', username || '(invalid-account)')
  if (!rate.allowed) {
    setResponseHeader(event, 'Retry-After', rate.retryAfterSec)
    dispatchSecurityAlert('login.locked', alertDetailsFromEvent(event, {username, reason: 'Login attempt budget exhausted'}))
    throw createError({statusCode: 429, message: 'Too many login attempts'})
  }

  // ---- Config sanity check -------------------------------------------------
  if (!await isSetupCompleted()) {
    throw createError({
      statusCode: 503,
      message: 'Admin setup is required.'
    })
  }

  // ---- Verify credentials --------------------------------------------------
  const account = await findUserByUsername(username)
  const passwordOk = await verifyUserPassword(account, password, requestAbortSignal(event))
  const isValid = Boolean(account?.active && /^[a-f0-9]{48}$/.test(account.auth_epoch) && passwordOk)

  if (!isValid) {
    recordActivity(event, {
      action: 'auth.login.failed',
      resource_type: 'session',
      resource_id: null,
      metadata: { username: username || null },
      description: 'Failed login attempt'
    })
    dispatchSecurityAlert('login.failed', alertDetailsFromEvent(event, {
      username: username || null,
      reason: 'Invalid username or password'
    }))

    throw createError({ statusCode: 401, message: 'Invalid username or password' })
  }

  // ---- Issue session -------------------------------------------------------
  const user = toSessionUser(account!)

  // ---- Second factor (TOTP) ------------------------------------------------
  // A valid password is not enough when the account has MFA enabled, or when
  // enforcement requires an admin-tier account to enrol. In both cases we hold
  // a short-lived pending state in the session cookie and DO NOT issue a full
  // `user` session until the second step completes.
  const mfaState = await getUserMfaState(user.id)
  if (mfaState?.enabled) {
    const trustedDevice = await findMatchingTrustedDevice(event, user.id)
    if (trustedDevice) {
      const trustedContext = await resolveTrustedDeviceContext(event)
      if (trustedDeviceContextMatches(trustedDevice, trustedContext)) {
        await replaceUserSession(event, {
          secure: {authEpoch: account!.auth_epoch, authenticatedAt: new Date().toISOString()},
          user,
          loggedInAt: new Date().toISOString()
        })
        try {
          await refreshTrustedDevice(event, trustedDevice, trustedContext)
        } catch (error) {
          console.warn('[auth.login] trusted device refresh failed; login continues', error)
        }
        await touchUserLogin(user.id)

        recordActivity(event, {
          action: 'auth.login',
          resource_type: 'session',
          resource_id: user.id,
          metadata: { username: user.username, mfa: true, trusted_device: true },
          description: 'User signed in'
        })
        dispatchSecurityAlert('login.success', alertDetailsFromEvent(event, {
          username: user.username,
          reason: 'MFA trusted device'
        }))

        return { user }
      }
    }

    await setMfaPending(event, user.id, 'verify', account!.auth_epoch)
    return { mfa_required: true }
  }

  const security = getSecuritySettings()
  if (security.security_mfa_required_for_admins) {
    await setMfaPending(event, user.id, 'enroll', account!.auth_epoch)
    return { mfa_enrollment_required: true }
  }

  await replaceUserSession(event, {
    secure: {authEpoch: account!.auth_epoch, authenticatedAt: new Date().toISOString()},
    user,
    loggedInAt: new Date().toISOString()
  })
  await touchUserLogin(user.id)

  recordActivity(event, {
    action: 'auth.login',
    resource_type: 'session',
    resource_id: user.id,
    metadata: { username: user.username },
    description: 'User signed in'
  })
  dispatchSecurityAlert('login.success', alertDetailsFromEvent(event, {
    username: user.username,
    reason: 'Password'
  }))

  return { user }
})