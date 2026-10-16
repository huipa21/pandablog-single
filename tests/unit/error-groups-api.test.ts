import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, createRouter, createError, defineEventHandler, getQuery, getRouterParam, getRouterParams, readBody, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bulkErrorGroupsSchema, errorFingerprintSchema, errorGroupListSchema } from '../../server/utils/error-groups'
const mocks = vi.hoisted(() => ({ requireOwner: vi.fn(), listErrorGroups: vi.fn(), readErrorGroup: vi.fn(), bulkErrorGroups: vi.fn(), readLogById: vi.fn() }))
vi.mock('../../server/utils/auth', () => ({ requireOwner: mocks.requireOwner }))
vi.mock('../../server/utils/logging', () => ({ readLogById: mocks.readLogById }))
vi.mock('../../server/utils/db', () => ({ queryDb: vi.fn(), useDb: vi.fn() }))
vi.mock('../../server/utils/error-groups', async importOriginal => ({ ...await importOriginal<typeof import('../../server/utils/error-groups')>(), ...mocks }))
let server: Server
let base: string
const fp = '0123456789abcdef'
beforeEach(async () => {
  vi.clearAllMocks()
  for (const [name, value] of Object.entries({ createError, defineEventHandler, getQuery, getRouterParam, getRouterParams, readBody })) vi.stubGlobal(name, value)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: {} }))
  mocks.requireOwner.mockResolvedValue({ id: 'users:admin', username: 'admin' })
  mocks.listErrorGroups.mockResolvedValue({ rows: [{ fingerprint: fp }], total: 1 })
  mocks.readErrorGroup.mockResolvedValue({ group: { fingerprint: fp }, occurrences: [] })
  mocks.bulkErrorGroups.mockResolvedValue({ ok: true, updated: 1 })
  mocks.readLogById.mockResolvedValue({ id: 'error_logs:one' })
  const router = createRouter()
  router.get('/api/admin/logs/error-groups', (await import('../../server/api/admin/logs/error-groups/index.get')).default)
  router.get('/api/admin/logs/error-groups/:fp', (await import('../../server/api/admin/logs/error-groups/[fp].get')).default)
  router.post('/api/admin/logs/error-groups/bulk', (await import('../../server/api/admin/logs/error-groups/bulk.post')).default)
  router.get('/api/admin/logs/errors', defineEventHandler(() => ({ rows: [] })))
  router.get('/api/admin/logs/errors/:id', (await import('../../server/api/admin/logs/errors/[id].get')).default)
  router.get('/api/admin/logs/:type/:id', (await import('../../server/api/admin/logs/[type]/[id].get')).default)
  const app = createApp(); app.use(router)
  server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterEach(async () => {
  server?.closeAllConnections()
  if (server) await new Promise<void>(resolve => server.close(() => resolve()))
  vi.unstubAllGlobals()
})
function bulk(body: unknown) { return fetch(`${base}/api/admin/logs/error-groups/bulk`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) }

describe('error groups real H3 routing with mocked auth/storage', () => {
  it('routes list, detail and bulk ahead of generic detail, validates and authorizes all three', async () => {
    expect((await fetch(`${base}/api/admin/logs/error-groups?sort=count&limit=25`)).status).toBe(200)
    expect(mocks.listErrorGroups).toHaveBeenCalledWith(errorGroupListSchema.parse({ sort: 'count', limit: '25' }))
    expect((await fetch(`${base}/api/admin/logs/error-groups/${fp}`)).status).toBe(200)
    expect(mocks.readErrorGroup).toHaveBeenCalledWith(fp)
    expect((await bulk({ action: 'resolve', ids: [fp] })).status).toBe(200)
    expect(mocks.bulkErrorGroups).toHaveBeenCalledWith(bulkErrorGroupsSchema.parse({ action: 'resolve', ids: [fp] }))
    expect(mocks.requireOwner).toHaveBeenCalledTimes(3)
    expect(errorFingerprintSchema.safeParse(fp).success).toBe(true)
  })
  it('keeps occurrence detail working despite the static errors list parent', async () => {
    const response = await fetch(`${base}/api/admin/logs/errors/${encodeURIComponent('error_logs:one')}`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ record: { id: 'error_logs:one' } })
    expect(mocks.readLogById).toHaveBeenCalledWith('errors', 'error_logs:one')
  })
  it('returns 400 for malformed query, fingerprint or bulk payload before querying storage', async () => {
    expect((await fetch(`${base}/api/admin/logs/error-groups?sort=timestamp`)).status).toBe(400)
    expect((await fetch(`${base}/api/admin/logs/error-groups/not-a-fingerprint`)).status).toBe(400)
    expect((await bulk({ action: 'delete', ids: [] })).status).toBe(400)
    expect(mocks.listErrorGroups).not.toHaveBeenCalled()
    expect(mocks.readErrorGroup).not.toHaveBeenCalled()
    expect(mocks.bulkErrorGroups).not.toHaveBeenCalled()
  })
  it.each([401, 403])('denies unauthenticated/non-superadmin access (%s) before validation', async statusCode => {
    mocks.requireOwner.mockRejectedValue(createError({ statusCode, message: 'Denied' }))
    expect((await fetch(`${base}/api/admin/logs/error-groups`)).status).toBe(statusCode)
    expect((await fetch(`${base}/api/admin/logs/error-groups/${fp}`)).status).toBe(statusCode)
    expect((await bulk({ action: 'delete', ids: [fp] })).status).toBe(statusCode)
    expect(mocks.listErrorGroups).not.toHaveBeenCalled()
    expect(mocks.readErrorGroup).not.toHaveBeenCalled()
    expect(mocks.bulkErrorGroups).not.toHaveBeenCalled()
  })
  it('returns 404 for missing groups', async () => {
    mocks.readErrorGroup.mockResolvedValue(null)
    expect((await fetch(`${base}/api/admin/logs/error-groups/${fp}`)).status).toBe(404)
  })
})
