import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { createApp, createError, createRouter, defineEventHandler, getRouterParam, setResponseHeader, toNodeListener, useSession, type H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({unavailable: false, epoch: 'a'.repeat(48), active: true, id: 'users:admin'}))
vi.mock('../../server/utils/settings', () => ({isSetupCompleted: async () => true}))
vi.mock('../../server/utils/users', () => ({
  OWNER_ID: 'users:admin',
  findAuthAccountById: async (id: string) => {
    if (state.unavailable) throw new Error('isolated outage')
    return id === 'users:admin' ? {id, username: 'admin', active: state.active, auth_epoch: state.epoch} : null
  }
}))
vi.mock('../../server/utils/mfa/trusted-devices', () => ({listTrustedDevices: async () => []}))
afterEach(() => vi.unstubAllGlobals())

describe('real H3 routes with copied encrypted cookies and current-state fixtures', () => {
  it('owner routes, optional session and Nuxt hook cannot trust stale or non-owner cookies', async () => {
    const config = {name: 'nuxt-session', password: randomBytes(48).toString('hex')}
    const getSession = async (event: H3Event) => ({...(await useSession(event, config)).data})
    let fetchHook: (session: Record<string, unknown>, event: H3Event) => Promise<void> = async () => {}
    for (const [name, value] of Object.entries({defineEventHandler, defineNitroPlugin: (fn: () => void) => fn, createError, getRouterParam, getUserSession: getSession, setResponseHeader,
      sessionHooks: {hook: (_name: string, hook: typeof fetchHook) => {fetchHook = hook}}})) vi.stubGlobal(name, value)
    const {default: devices} = await import('../../server/api/admin/auth/devices/list.get')
    const {default: sessionRead} = await import('../../server/api/auth/session.get')
    const {default: plugin} = await import('../../server/plugins/current-session')
    ;(plugin as unknown as () => void)()
    const router = createRouter()
    router.get('/fixture/session', defineEventHandler(async event => {
      const session = await useSession(event, config)
      await session.update({user: {id: state.id, username: 'cookie-display'}, secure: {authEpoch: state.epoch}, mfaEnroll: {secret: 'must-not-leak'}})
      return {ok: true}
    }))
    router.get('/api/admin/auth/devices/list', devices)
    router.get('/api/auth/session', sessionRead)
    router.get('/api/_auth/session', defineEventHandler(async event => {
      const session = await getSession(event)
      await fetchHook(session, event)
      const {secure: _secure, ...data} = session
      return data // same installed nuxt-auth-utils boundary, actual app fetch hook
    }))
    const app = createApp(); app.use(router)
    const server = createServer(toNodeListener(app))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as {port: number}).port}`
    const get = (path: string, cookie: string) => fetch(`${base}${path}`, {headers: {cookie}})
    try {
      const issued = await fetch(`${base}/fixture/session`)
      const cookie = issued.headers.get('set-cookie')!.split(';')[0]!
      expect((await get('/api/admin/auth/devices/list', cookie)).status).toBe(200)
      const profile = await (await get('/api/_auth/session', cookie)).json()
      expect(profile.user).toMatchObject({id: 'users:admin', username: 'admin'})
      expect(JSON.stringify(profile)).not.toMatch(/authEpoch|must-not-leak/)
      state.epoch = 'b'.repeat(48)
      expect((await (await get('/api/auth/session', cookie)).json()).loggedIn).toBe(false)
      expect((await get('/api/admin/auth/devices/list', cookie)).status).toBe(401)
      state.epoch = 'a'.repeat(48); state.active = false
      expect((await get('/api/admin/auth/devices/list', cookie)).status).toBe(401)
      state.active = true; state.unavailable = true
      expect((await get('/api/auth/session', cookie)).status).toBe(503)
      expect((await get('/api/_auth/session', cookie)).status).toBe(503)
      expect((await get('/api/admin/auth/devices/list', cookie)).status).toBe(503)
      state.unavailable = false; state.id = 'users:fixture'
      const foreign = (await fetch(`${base}/fixture/session`)).headers.get('set-cookie')!.split(';')[0]!
      expect((await get('/api/admin/auth/devices/list', foreign)).status).toBe(401)
    } finally {state.unavailable = false; state.active = true; state.id = 'users:admin'; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))}
  })
})
