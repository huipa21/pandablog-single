import { readBoundedJson } from '../../utils/bounded-json'
import { adminPasswordProblem, hashAdminPassword } from '../../utils/admin-password'
import { recordActivity } from '../../utils/activity'
import { useDb } from '../../utils/db'
import { createSetupOwner, setupAuthority } from '../../utils/setup-authority'
import { consumeRateLimit } from '../../utils/rate-limit'
import { findUserByUsername, toSessionUser } from '../../utils/users'

export default defineEventHandler(async (event) => {
  const authority = setupAuthority()
  await authority.assertNoMaintenance()

  const body = await readBoundedJson(event, 8 * 1024)
  const password = typeof body.password === 'string' ? body.password : ''
  const confirmPassword = typeof body.confirm_password === 'string' ? body.confirm_password : ''

  const passwordError = adminPasswordProblem(password)
  if (passwordError) {
    throw createError({ statusCode: 400, message: passwordError })
  }

  if (password !== confirmPassword) {
    throw createError({ statusCode: 400, message: 'Passwords do not match' })
  }

  const ip = getRequestIP(event, {xForwardedFor: true}) ?? 'noip'
  const rate = await consumeRateLimit('setup-ip', ip, {limit: 5, windowMs: 15 * 60 * 1000})
  if (!rate.allowed) {setResponseHeader(event, 'Retry-After', rate.retryAfterSec); throw createError({statusCode: 429, message: 'Too many setup attempts'})}
  const db = await useDb()
  const current = await authority.status(db)
  if (current.completed) throw createError({statusCode: current.recoveryRequired ? 503 : 409, message: current.recoveryRequired ? 'Setup recovery is required' : 'Admin setup has already been completed'})
  const passwordHash = await hashAdminPassword(password)
  const reservation = await authority.reserve(db)
  try {
    await authority.assertNoMaintenance()
    await createSetupOwner(db, passwordHash, reservation)
    await authority.complete(reservation)
  } catch (error) {authority.abandon(reservation); throw error}
  const adminUser = await findUserByUsername('admin')
  if (!adminUser?.active || adminUser.auth_epoch !== reservation.epoch) {
    throw createError({ statusCode: 500, message: 'Admin account was not created' })
  }
  const user = toSessionUser(adminUser)

  await replaceUserSession(event, {
    secure: {authEpoch: adminUser.auth_epoch, authenticatedAt: new Date().toISOString()},
    user,
    loggedInAt: new Date().toISOString()
  })

  recordActivity(event, {
    action: 'auth.setup',
    resource_type: 'session',
    resource_id: user.id,
    metadata: { username: user.username },
    description: 'Admin account setup completed'
  })

  return { user }
})