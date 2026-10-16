import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createApp, createError, createRouter, defineEventHandler, getRequestURL, getRouterParams, readBody, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ requireOwner: vi.fn(), purgeLogType: vi.fn() }))
vi.mock('../../server/utils/auth', () => ({ requireOwner: mocks.requireOwner }))
vi.mock('../../server/utils/logging', () => ({ purgeLogType: mocks.purgeLogType }))
vi.mock('../../server/utils/db', () => ({ useDb: vi.fn(), queryDb: vi.fn() }))

let server: Server
let base: string
beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  for (const [name, value] of Object.entries({ createError, defineEventHandler, getRequestURL, getRouterParams, readBody })) vi.stubGlobal(name, value)
  vi.stubGlobal('useRuntimeConfig', () => ({ public: {} }))
  mocks.requireOwner.mockResolvedValue({ id: 'users:admin', username: 'admin' })
  mocks.purgeLogType.mockResolvedValue(7)
  const app = createApp()
  const router = createRouter()
  router.delete('/api/admin/logs/:type', (await import('../../server/api/admin/logs/[type].delete')).default)
  for (const type of ['access', 'activity', 'errors', 'stats']) router.get(`/api/admin/logs/${type}`, defineEventHandler(() => ({ ok: true })))
  app.use(router)
  server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterEach(async () => {
  server?.closeAllConnections()
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  vi.unstubAllGlobals()
})
function purge(type: string, token = `PURGE_${type.toUpperCase()}`) {
  return fetch(`${base}/api/admin/logs/${type}`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm_token: token }) })
}

describe('log purge HTTP routing', () => {
  it.each(['activity', 'errors'])('preserves DELETE %s despite a static GET route with no dynamic params', async (type) => {
    const response = await purge(type)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, deleted: 7 })
    expect(mocks.requireOwner).toHaveBeenCalledOnce()
    expect(mocks.purgeLogType).toHaveBeenCalledExactlyOnceWith(type)
    // H3 caches the fallback handler on the static route. Subsequent calls must work too.
    expect((await purge(type)).status).toBe(200)
    expect(mocks.purgeLogType).toHaveBeenCalledTimes(2)
  })

  it('rejects retired access purge before reading confirmation or deleting', async () => {
    const response = await purge('access')
    expect(response.status).toBe(404)
    expect(mocks.purgeLogType).not.toHaveBeenCalled()
  })

  it('rejects an invalid confirmation token without deleting', async () => {
    const response = await purge('errors', 'PURGE_ACCESS')
    expect(response.status).toBe(400)
    await response.text()
    expect(mocks.purgeLogType).not.toHaveBeenCalled()
  })

  it.each(['stats', 'unknown'])('does not turn an unsupported %s route into a purge target', async (type) => {
    const response = await purge(type)
    expect(response.status).toBe(400)
    await response.text()
    expect(mocks.purgeLogType).not.toHaveBeenCalled()
  })

  it.each([401, 403])('enforces authorization before considering the pathname (HTTP %i)', async (statusCode) => {
    mocks.requireOwner.mockRejectedValue(createError({ statusCode, message: 'Denied' }))
    const response = await purge('access')
    expect(response.status).toBe(statusCode)
    await response.text()
    expect(mocks.purgeLogType).not.toHaveBeenCalled()
  })
})
