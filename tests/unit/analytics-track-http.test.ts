import { createServer, request } from 'node:http'
import { createApp, defineEventHandler, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({query: vi.fn(), record: vi.fn(), user: vi.fn(), enabled: false}))
vi.mock('../../server/utils/db', () => ({useDb: async () => ({}), queryDb: mocks.query}))
vi.mock('../../server/utils/settings', () => ({getAnalyticsSettings: () => ({analytics_enabled: mocks.enabled, analytics_session_window_minutes: 30}), getRuntimeFlags: () => ({trust_proxy_headers: false})}))
vi.mock('../../server/utils/auth', () => ({isOwner: async () => Boolean(await mocks.user())}))
vi.mock('../../server/utils/analytics/session', () => ({recordAnalyticsPageview: mocks.record}))
vi.mock('../../server/utils/analytics/hash', () => ({hashAnalyticsVisitor: async () => '1'.repeat(64)}))
vi.mock('../../server/utils/visibility', () => ({evaluatePostAccess: async () => ({state: 'allow'})}))
vi.mock('../../server/utils/rate-limit', () => ({consumeRateLimit: async () => ({allowed: true})}))
let server: ReturnType<typeof createServer> | undefined
beforeEach(() => {vi.stubGlobal('defineEventHandler', defineEventHandler); mocks.query.mockReset().mockResolvedValue([[{id: 'post:fixture', visibility: 'public'}]]); mocks.user.mockReset().mockResolvedValue(null); mocks.record.mockReset().mockResolvedValue('analytics_session:fixture'); mocks.enabled = false})
afterEach(async () => {if (server) {server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve()))}; server = undefined; vi.unstubAllGlobals()})
async function send(body: unknown, agent = 'Mozilla/5.0') {
  const handler = (await import('../../server/api/analytics/track.post')).default
  const app = createApp(); app.use('/track', handler); server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as {port: number}).port
  return new Promise<number>((resolve, reject) => {
    const req = request({hostname: '127.0.0.1', port, path: '/track', method: 'POST', headers: {'content-type': 'application/json', 'user-agent': agent}}, res => {res.resume(); res.on('end', () => resolve(res.statusCode!))})
    req.on('error', reject)
    const data = JSON.stringify(body)
    for (let index = 0; index < data.length; index += 1024) req.write(data.slice(index, index + 1024))
    req.end()
  })
}
describe('actual H3 bounded analytics tracking boundary', () => {
  it('increments published post views when collection is disabled, without creating a session/event', async () => {
    expect(await send({path: '/blog/fixture'})).toBe(204)
    expect(mocks.query.mock.calls.some(call => String(call[1]).includes('view_count += 1'))).toBe(true)
    expect(mocks.record).not.toHaveBeenCalled()
  })
  it('commits enabled public tracking through one atomic event helper', async () => {
    mocks.enabled = true
    expect(await send({path: '/blog/fixture', referrer: '/from'})).toBe(204)
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith({}, '1'.repeat(64), expect.any(Date), 30, {path: '/blog/fixture', referrer: '/from'})
  })
  it.each(['null', 'oversized', 'staff', 'bot'])('silently drops %s beacons without any writes', async kind => {
    mocks.enabled = true
    if (kind === 'staff') mocks.user.mockResolvedValue({id: 'users:admin', username: 'admin'})
    expect(await send(kind === 'null' ? null : {path: '/blog/fixture', ...(kind === 'oversized' ? {padding: 'x'.repeat(9000)} : {})}, kind === 'bot' ? 'Googlebot' : undefined)).toBe(204)
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.record).not.toHaveBeenCalled()
  })
})
