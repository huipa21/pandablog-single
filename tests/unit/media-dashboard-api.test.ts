import { createServer } from 'node:http'
import { createApp, createError, defineEventHandler, getQuery, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({auth: vi.fn(), dashboard: vi.fn(), query: vi.fn()}))
vi.mock('../../server/utils/auth', () => ({requireOwner: mocks.auth}))
vi.mock('../../server/utils/db', () => ({useDb: async () => ({}), queryDb: mocks.query}))
vi.mock('../../server/utils/settings', () => ({getMediaSettings: async () => ({oversized_image_threshold_mb: 2, max_file_size_mb: 20})}))
vi.mock('../../server/utils/media-dashboard', () => ({mediaDashboard: mocks.dashboard}))
const user = {id: 'users:admin', username: 'admin'}
let server: ReturnType<typeof createServer> | undefined
beforeEach(() => {
  mocks.auth.mockReset().mockResolvedValue(user)
  mocks.dashboard.mockReset().mockResolvedValue({summary: {total_items: 2}})
  mocks.query.mockReset().mockResolvedValue([[]])
  for (const [key, value] of Object.entries({defineEventHandler, createError, getQuery})) vi.stubGlobal(key, value)
})
afterEach(async () => {
  if (server) {server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve()))}
  server = undefined
  vi.unstubAllGlobals()
})
async function setup() {
  const app = createApp()
  app.use('/dashboard', (await import('../../server/api/admin/dashboard/media.get')).default)
  app.use('/tags', (await import('../../server/api/media/tags.get')).default)
  server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as {port: number}).port}`
}

describe('media dashboard and tags API boundaries', () => {
  it.each(['', '?range=invalid'])('defaults to all-time inventory (%s)', async query => {
    const response = await fetch(`${await setup()}/dashboard${query}`)
    expect(response.status).toBe(200)
    expect(mocks.dashboard).toHaveBeenCalledWith({}, user, {range: 'all', start: null, end: expect.any(Date)}, 2 * 1024 * 1024)
  })
  it('preserves explicitly selected date ranges', async () => {
    const response = await fetch(`${await setup()}/dashboard?range=7d`)
    expect(response.status).toBe(200)
    expect(mocks.dashboard.mock.calls[0]![2]).toMatchObject({range: '7d', start: expect.any(Date), end: expect.any(Date)})
  })
  it('excludes empty tag arrays before SPLIT while retaining scope, limits and bound search', async () => {
    const response = await fetch(`${await setup()}/tags?q=%20NATURE%20`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({tags: [], truncated: false})
    const [, sql, params, options] = mocks.query.mock.calls[0]!
    expect(sql).toContain('AND array::len(tags) > 0 SPLIT tags')
    expect(sql).toContain("visibility IN ['public', 'private']")
    expect(sql).toContain("storage_state = 'ready'")
    expect(sql).toContain('LIMIT 201 TIMEOUT 5s')
    expect(params).toMatchObject({search: 'nature'})
    expect(options).toMatchObject({retry: 'readOnly', timeoutMs: 6000})
  })
  it('preserves tag summary serialization', async () => {
    mocks.query.mockResolvedValue([[{key: 'nature', name: 'Nature', count: 2, latest: new Date('2024-01-01T00:00:00Z')}]])
    const response = await fetch(`${await setup()}/tags`)
    expect(await response.json()).toEqual({tags: [{id: 'nature', name: 'Nature', slug: 'nature', count: 2, latest_uploaded_at: '2024-01-01T00:00:00.000Z'}], truncated: false})
  })
  it('rejects oversized tag searches before querying', async () => {
    expect((await fetch(`${await setup()}/tags?q=${'a'.repeat(81)}`)).status).toBe(400)
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it('authenticates before either query', async () => {
    const base = await setup()
    mocks.auth.mockRejectedValue(createError({statusCode: 403, message: 'Forbidden'}))
    expect((await fetch(`${base}/dashboard`)).status).toBe(403)
    expect((await fetch(`${base}/tags`)).status).toBe(403)
    expect(mocks.dashboard).not.toHaveBeenCalled()
    expect(mocks.query).not.toHaveBeenCalled()
  })
})
