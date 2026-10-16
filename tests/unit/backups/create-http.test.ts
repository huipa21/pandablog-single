import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { createApp, createError, defineEventHandler, readBody, setResponseStatus, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({requireOwner: vi.fn(), startBackupJob: vi.fn()}))
vi.mock('../../../server/utils/auth', () => mocks)
vi.mock('../../../server/utils/backups/create', () => mocks)
let server: Server, origin: string
beforeEach(async () => {
  vi.resetAllMocks(); mocks.startBackupJob.mockResolvedValue('owned-full')
  for (const [name, value] of Object.entries({defineEventHandler, createError, readBody, setResponseStatus})) vi.stubGlobal(name, value)
  const {default: handler} = await import('../../../server/api/admin/backups/index.post')
  const app = createApp(); app.use('/api/admin/backups', handler)
  server = createServer(toNodeListener(app)); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  origin = `http://127.0.0.1:${(server.address() as {port: number}).port}`
})
afterEach(async () => {server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); vi.unstubAllGlobals()})
const post = (body: unknown) => fetch(`${origin}/api/admin/backups`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body)})
describe('full-only create API on real H3 routing (mocked current authorization/job)', () => {
  it.each([{}, {type: 'full'}, {note: 'portable'}])('accepts a full-only request %j with existing 202 shape', async body => {
    const response = await post(body)
    expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ok: true, id: 'owned-full'})
    expect(mocks.startBackupJob).toHaveBeenCalledExactlyOnceWith(body)
  })
  it.each([{type: 'partial'}, {type: 'incremental'}, {parent: null}, {tables: []}, {extra: true}])('rejects retired input %j before starting a job', async body => {
    expect((await post(body)).status).toBe(400)
    expect(mocks.startBackupJob).not.toHaveBeenCalled()
  })
  it('authorization failure never starts a job', async () => {
    mocks.requireOwner.mockRejectedValue(createError({statusCode: 403}))
    expect((await post({})).status).toBe(403); expect(mocks.startBackupJob).not.toHaveBeenCalled()
  })
})
