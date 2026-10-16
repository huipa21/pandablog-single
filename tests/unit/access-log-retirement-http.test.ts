import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, createError, createRouter, defineEventHandler, getQuery, getRequestURL, getRouterParams, readBody, setHeader, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireOwner: vi.fn(), readLogById: vi.fn(), purgeLogType: vi.fn(), runManualLogCleanup: vi.fn(), useDb: vi.fn(), queryDb: vi.fn() }))
vi.mock('../../server/utils/auth', () => ({ requireOwner: mocks.requireOwner }))
vi.mock('../../server/utils/logging', () => mocks)
vi.mock('../../server/utils/db', () => mocks)
let server: Server | undefined, base: string
beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks()
  for (const [key, value] of Object.entries({ createError, defineEventHandler, getQuery, getRequestURL, getRouterParams, readBody, setHeader })) vi.stubGlobal(key, value)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: {} }))
  mocks.requireOwner.mockResolvedValue({ id: 'users:admin', username: 'admin' })
  const app = createApp(), router = createRouter()
  router.get('/api/admin/logs/:type/export', (await import('../../server/api/admin/logs/[type]/export.get')).default)
  router.get('/api/admin/logs/:type/:id', (await import('../../server/api/admin/logs/[type]/[id].get')).default)
  router.delete('/api/admin/logs/:type', (await import('../../server/api/admin/logs/[type].delete')).default)
  router.post('/api/admin/logs/cleanup', (await import('../../server/api/admin/logs/cleanup.post')).default)
  app.use(router); server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterEach(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server!.close(error => error ? reject(error) : resolve())); server = undefined }
  vi.unstubAllGlobals()
})
function noHistoryOperations() {
  for (const fn of [mocks.readLogById, mocks.purgeLogType, mocks.runManualLogCleanup, mocks.useDb, mocks.queryDb]) expect(fn).not.toHaveBeenCalled()
}
describe('retired access HTTP contracts', () => {
  it.each(['', '/2020-01-01:old', '/hourly', '/export?format=csv', '/export?format=json'])('GET access%s is 404, including generic handler fallbacks', async suffix => {
    const response = await fetch(base + '/api/admin/logs/access' + suffix)
    expect(response.status).toBe(404); await response.text(); noHistoryOperations()
  })
  it('cannot purge with the old confirmation token', async () => {
    const response = await fetch(base + '/api/admin/logs/access', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm_token: 'PURGE_ACCESS' }) })
    expect(response.status).toBe(404); noHistoryOperations()
  })
  it.each(['older_than_days', 'keep_latest'])('rejects access cleanup %s before any deletion/audit', async mode => {
    const response = await fetch(base + '/api/admin/logs/cleanup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'access', mode, value: 30 }) })
    expect(response.status).toBe(400); noHistoryOperations()
  })
  it.each([401, 403])('retained generic handlers still authorize first (HTTP %i)', async statusCode => {
    mocks.requireOwner.mockRejectedValue(createError({ statusCode, message: 'Denied' }))
    expect((await fetch(base + '/api/admin/logs/access/export')).status).toBe(statusCode)
    noHistoryOperations()
  })
})
