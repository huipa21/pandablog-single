import { createError } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMfaPending, resolveMfaActor } from '../../server/utils/mfa/session'
import { getSessionUser, requireOwner, isOwner } from '../../server/utils/auth'

const state = vi.hoisted(() => ({ cookie: true, account: null as Record<string, unknown> | null, find: vi.fn(), session: {} as Record<string, unknown> }))
vi.mock('../../server/utils/users', () => ({ OWNER_ID: 'users:admin', findAuthAccountById: state.find }))
vi.mock('../../server/utils/settings', () => ({isSetupCompleted: async () => true}))
vi.mock('../../server/utils/session-cookie', () => ({hasAuthSessionCookie: () => state.cookie}))
const epoch = 'a'.repeat(48)
const event = () => ({context: {}} as never)
beforeEach(() => {
  state.cookie = true
  state.account = {id: 'users:admin', username: 'admin', display_name: 'Owner', active: true, auth_epoch: epoch}
  state.session = {user: {id: 'users:admin', username: 'forged-display'}, secure: {authEpoch: epoch}}
  state.find.mockReset().mockImplementation(async () => state.account)
  vi.stubGlobal('createError', createError)
  vi.stubGlobal('getUserSession', async () => state.session)
  vi.stubGlobal('requireUserSession', async () => state.session)
  vi.stubGlobal('clearUserSession', async () => {})
})
afterEach(() => vi.unstubAllGlobals())

describe('current identity and owner authorization', () => {
  it('current account display wins and is memoized only within one request', async () => {
    const req = event()
    expect(await getSessionUser(req)).toMatchObject({username: 'admin', display_name: 'Owner'})
    await expect(requireOwner(req)).resolves.toMatchObject({id: 'users:admin'})
    expect(state.find).toHaveBeenCalledTimes(1)
    expect(await getSessionUser(event())).not.toHaveProperty('auth_epoch')
    expect(state.find).toHaveBeenCalledTimes(2)
  })
  it.each(['disable', 'delete', 'rotate', 'recreate', 'legacy'])('rejects copied cookie after %s', async mode => {
    if (mode === 'disable') state.account!.active = false
    if (mode === 'delete') state.account = null
    if (mode === 'rotate' || mode === 'recreate') state.account!.auth_epoch = 'b'.repeat(48)
    if (mode === 'legacy') delete state.session.secure
    expect(await getSessionUser(event())).toBeNull()
    await expect(requireOwner(event())).rejects.toMatchObject({statusCode: 401})
  })
  it('only the owner account is accepted', async () => {
    expect(await isOwner(event())).toBe(true)
    state.session.user = {id: 'users:fixture'}
    expect(await getSessionUser(event())).toBeNull()
    expect(state.find).toHaveBeenCalledTimes(1)
    await expect(requireOwner(event())).rejects.toMatchObject({statusCode: 401})
  })
  it('DB outage is 503 for optional and required identity, never anonymous/public fallback', async () => {
    state.find.mockRejectedValue(new Error('fixture database unavailable'))
    await expect(getSessionUser(event())).rejects.toMatchObject({statusCode: 503})
    await expect(requireOwner(event())).rejects.toMatchObject({statusCode: 503})
    await expect(isOwner(event())).rejects.toMatchObject({statusCode: 503})
  })
  it('pending enrollment is epoch/active/time bound and never a full admin session', async () => {
    state.session = {mfaPending: {userId: 'users:admin', mode: 'enroll', createdAt: new Date().toISOString()}, secure: {authEpoch: epoch}}
    expect(await getSessionUser(event())).toBeNull()
    expect(await resolveMfaActor(event())).toMatchObject({userId: 'users:admin', finalize: true, authEpoch: epoch})
    state.account!.auth_epoch = 'b'.repeat(48)
    expect(await getMfaPending(event())).toBeNull()
    await expect(resolveMfaActor(event())).rejects.toMatchObject({statusCode: 401})
    state.account!.auth_epoch = epoch
    state.session.mfaPending = {userId: 'users:admin', mode: 'enroll', createdAt: new Date(Date.now() + 60_000).toISOString()}
    expect(await getMfaPending(event())).toBeNull()
  })
  it('no-cookie requests skip identity DB work', async () => {
    state.cookie = false
    expect(await getSessionUser(event())).toBeNull()
    expect(state.find).not.toHaveBeenCalled()
  })
})
