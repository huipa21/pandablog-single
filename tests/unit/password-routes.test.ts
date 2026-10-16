import { createServer, request } from 'node:http'
import { createApp, createError, defineEventHandler, getRequestIP, readBody, setResponseHeader, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ verify: vi.fn(async () => true), mfa: false, pending: vi.fn() }))
vi.mock('../../server/utils/activity', () => ({recordActivity: vi.fn()}))
vi.mock('../../server/utils/notify/security-alert', () => ({dispatchSecurityAlert: vi.fn(), alertDetailsFromEvent: vi.fn()}))
vi.mock('../../server/utils/settings', () => ({getRuntimeFlags: () => ({trust_proxy_headers: true}), isSetupCompleted: async () => true, getSecuritySettings: () => ({})}))
vi.mock('../../server/utils/users', () => ({findUserByUsername: async (username: string) => ({id: `users:${username}`, username, active: true, auth_epoch: 'a'.repeat(48)}), verifyUserPassword: state.verify, toSessionUser: (user: unknown) => user, touchUserLogin: async () => {}}))
vi.mock('../../server/utils/mfa/store', () => ({getUserMfaState: async () => ({enabled: state.mfa})}))
vi.mock('../../server/utils/mfa/session', () => ({setMfaPending: state.pending}))
vi.mock('../../server/utils/mfa/trusted-devices', () => ({findMatchingTrustedDevice: async () => null, refreshTrustedDevice: vi.fn(), resolveTrustedDeviceContext: vi.fn(), trustedDeviceContextMatches: vi.fn()}))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function withRoute(run: (base: string) => Promise<void>) {
  for (const [name, value] of Object.entries({defineEventHandler, createError, getRequestIP, readBody, setResponseHeader, setUserSession: async () => {}, replaceUserSession: async () => {}})) vi.stubGlobal(name, value)
  const { default: login } = await import('../../server/api/auth/login.post')
  const app = createApp()
  app.use('/api/auth/login', login)
  const server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  try { await run(`http://127.0.0.1:${(server.address() as {port: number}).port}`) }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
const post = (base: string, username: unknown, ip: string, password: unknown = 'fixture-password') => fetch(`${base}/api/auth/login`, {method: 'POST', headers: {'content-type': 'application/json', 'x-forwarded-for': ip}, body: JSON.stringify({username, password})})

describe('real H3 login pre-work rate reservations with synthetic accounts', () => {
  it('twenty concurrent correct first factors allow five KDF calls; MFA-pending does not reset either budget', async () => {
    state.mfa = true
    state.verify.mockClear()
    await withRoute(async base => {
      const results = await Promise.all(Array.from({length: 20}, () => post(base, 'fixture-pending', '192.0.2.10')))
      expect(results.filter(response => response.status === 200)).toHaveLength(5)
      expect(results.filter(response => response.status === 429)).toHaveLength(15)
      expect(results.find(response => response.status === 429)?.headers.get('retry-after')).toBeTruthy()
      expect(state.verify).toHaveBeenCalledTimes(5)
      const variedIp = await post(base, 'fixture-pending', '192.0.2.11')
      expect(variedIp.status).toBe(429) // independent global account dimension
      const variedAccount = await post(base, 'fixture-different', '192.0.2.10')
      expect(variedAccount.status).toBe(429) // independent IP dimension
    })
  })
  it('caps declared and actual chunked JSON bytes before rate/KDF work, including unrelated oversized fields', async () => {
    state.verify.mockClear()
    await withRoute(async base => {
      const payload = JSON.stringify({username: 'fixture', password: 'fixture-password', extra: 'x'.repeat(9000)})
      const declared = await fetch(`${base}/api/auth/login`, {method: 'POST', headers: {'content-type': 'application/json', 'x-forwarded-for': '192.0.2.13'}, body: payload})
      expect(declared.status).toBe(413)
      await declared.arrayBuffer()
      const chunkedStatus = await new Promise<number>((resolve, reject) => {
        const req = request(`${base}/api/auth/login`, {method: 'POST', headers: {'content-type': 'application/json', 'x-forwarded-for': '192.0.2.13'}}, response => {response.resume(); response.on('end', () => resolve(response.statusCode!))})
        req.on('error', reject)
        req.write(payload.slice(0, 5000)); req.end(payload.slice(5000))
      })
      expect(chunkedStatus).toBe(413)
      expect(state.verify).not.toHaveBeenCalled()
    })
  })
  it('oversized/non-string credentials return bounded 400 without KDF', async () => {
    state.verify.mockClear()
    await withRoute(async base => {
      for (const [username, password] of [[{}, 'fixture'], ['x'.repeat(65), 'fixture'], ['fixture', 'x'.repeat(201)], ['fixture', {}]]) {
        expect((await post(base, username, '192.0.2.12', password)).status).toBe(400)
      }
      expect(state.verify).not.toHaveBeenCalled()
    })
  })
})
