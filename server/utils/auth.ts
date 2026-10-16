import { createError, type H3Event } from 'h3'
import { isSetupCompleted } from './settings'
import { hasAuthSessionCookie } from './session-cookie'
import { findAuthAccountById, OWNER_ID, type SessionUser } from './users'

const identities = new WeakMap<H3Event, Promise<SessionUser | null>>()
const accounts = new WeakMap<H3Event, {id: string, value: ReturnType<typeof findAuthAccountById>}>()
export function getRequestAuthAccount(event: H3Event, id: string) {
  const cached = accounts.get(event)
  if (cached?.id === id) return cached.value
  const value = findAuthAccountById(id).catch(() => {throw createError({statusCode: 503, message: 'Identity service unavailable'})})
  accounts.set(event, {id, value})
  return value
}

/** Cookie display fields NEVER authorize; positive identity is request-local. */
export async function getSessionUser(event: H3Event): Promise<SessionUser | null> {
  let identity = identities.get(event)
  if (!identity) { identity = resolveCurrentIdentity(event); identities.set(event, identity) }
  return identity
}
async function resolveCurrentIdentity(event: H3Event): Promise<SessionUser | null> {
  if (!hasAuthSessionCookie(event)) return null
  const session = await getUserSession(event)
  const id = (session.user as {id?: unknown} | undefined)?.id
  const epoch = (session.secure as {authEpoch?: unknown} | undefined)?.authEpoch
  if (id !== OWNER_ID || typeof epoch !== 'string' || !/^[a-f0-9]{48}$/.test(epoch)) return null
  const account = await getRequestAuthAccount(event, id)
  if (!account || account.active !== true || account.auth_epoch !== epoch) return null
  // Explicit DTO: epochs/credential/MFA fields never escape through user APIs.
  return { id: account.id, username: account.username,
    display_name: account.display_name, avatar: account.avatar, avatar_url: account.avatar_url }
}

export async function requireOwner(event: H3Event): Promise<SessionUser> {
  if (!await isSetupCompleted()) throw createError({statusCode: 503, message: 'Admin setup is required'})
  const user = await getSessionUser(event)
  if (!user) throw createError({statusCode: 401, message: 'Authentication required'})
  return user
}
export async function isOwner(event: H3Event): Promise<boolean> { return Boolean(await getSessionUser(event)) }
