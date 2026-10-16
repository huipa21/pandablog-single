import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { createApp, createError, createRouter, defineEventHandler, getQuery, getRequestHeader, getRequestURL, sendRedirect, setResponseHeader, setResponseStatus, toNodeListener } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  useDb: vi.fn(), queryDb: vi.fn(), getSiteVisibility: vi.fn(), isOwner: vi.fn(), getActiveJob: vi.fn(),
  getRuntimeFlags: vi.fn()
}))
vi.mock('../../server/utils/db', () => mocks)
vi.mock('../../server/utils/visibility', () => ({ getSiteVisibility: mocks.getSiteVisibility }))
vi.mock('../../server/utils/auth', () => ({ isOwner: mocks.isOwner }))
vi.mock('../../server/utils/backups/jobMutex', () => ({ getActiveJob: mocks.getActiveJob }))
vi.mock('../../server/utils/maintenance', () => ({writeBarrier: {status: () => ({closed: Boolean(mocks.getActiveJob())})}}))
vi.mock('../../server/utils/settings', () => ({ getRuntimeFlags: mocks.getRuntimeFlags }))

const cliPath = fileURLToPath(new URL('../../bin/panda.mjs', import.meta.url))
let server: Server
let port: number
let base: string
let customStatus: number

beforeEach(async () => {
  vi.resetModules()
  vi.resetAllMocks()
  for (const [key, value] of Object.entries({ defineEventHandler, getQuery, getRequestHeader, getRequestURL, sendRedirect, setResponseHeader, setResponseStatus, createError })) {
    vi.stubGlobal(key, value)
  }
  mocks.getSiteVisibility.mockResolvedValue('private')
  mocks.isOwner.mockResolvedValue(false)
  mocks.getActiveJob.mockReturnValue({ kind: 'restore' })
  mocks.useDb.mockRejectedValue(new Error('DB unavailable'))
  mocks.getRuntimeFlags.mockReturnValue({ trust_proxy_headers: false })
  customStatus = 200

  const app = createApp()
  app.use((await import('../../server/middleware/request-id')).default)
  app.use((await import('../../server/middleware/api-origin')).default)
  app.use((await import('../../server/middleware/restore-maintenance')).default)
  app.use((await import('../../server/middleware/site-visibility')).default)
  const router = createRouter()
  router.get('/api/health', (await import('../../server/api/health.get')).default)
  router.get('/custom-status', defineEventHandler((event) => { setResponseStatus(event, customStatus); return { custom: true } }))
  router.get('/hanging', defineEventHandler(() => new Promise(() => {})))
  app.use(router)
  server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
  base = `http://127.0.0.1:${port}`
})
afterEach(async () => {
  server.closeAllConnections()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  vi.unstubAllGlobals()
})

function panda(args: string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number, stdout: string, stderr: string }>((resolve) => {
    execFile(process.execPath, [cliPath, ...args], {
      env: { ...process.env, NITRO_PORT: '', PORT: String(port), ...env }, timeout: 5000
    }, (error, stdout, stderr) => resolve({ code: Number(error?.code ?? 0), stdout, stderr }))
  })
}

describe('health HTTP/middleware integration', () => {
  it('stays public and DB-free during private mode and an active restore, without request/access logging', async () => {
    const response = await fetch(`${base}/api/health`, { headers: { origin: 'https://unrelated.example', 'sec-fetch-site': 'cross-site' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-request-id')).toBeNull()
    const body = await response.json()
    expect(Object.keys(body)).toEqual(['ok', 'uptime_s'])
    expect(body).toMatchObject({ ok: true, uptime_s: expect.any(Number) })
    expect(mocks.useDb).not.toHaveBeenCalled()
    expect(mocks.queryDb).not.toHaveBeenCalled()
    expect(mocks.getSiteVisibility).not.toHaveBeenCalled()
    expect(mocks.isOwner).not.toHaveBeenCalled()
  })

  it('returns no-store 503 for an explicitly requested failing DB check, also without access logs', async () => {
    const response = await fetch(`${base}/api/health?db=1`)
    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ ok: false, db: 'down' })
    expect(mocks.useDb).not.toHaveBeenCalled() // fenced diagnostics never allocate
    expect(mocks.isOwner).not.toHaveBeenCalled()
  })

  it('does not bypass the maintenance fence for similarly named unrelated routes', async () => {
    const response = await fetch(`${base}/api/healthz`)
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('15')
    await response.text()
  })

  it('keeps ordinary API requests private when no restore is active', async () => {
    mocks.getActiveJob.mockReturnValue(null)
    const response = await fetch(`${base}/api/health-other`)
    expect(response.status).toBe(401)
    await response.text()
    expect(mocks.getSiteVisibility).toHaveBeenCalledTimes(1)
    expect(mocks.isOwner).toHaveBeenCalledTimes(1)
  })
})

describe('panda health CLI', () => {
  it('uses /api/health and PORT by default and succeeds in private/restore mode', async () => {
    const result = await panda(['health', '--json'])
    expect(result.code).toBe(0)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, url: `${base}/api/health`, status: 200 })
    expect(mocks.useDb).not.toHaveBeenCalled()
  })

  it('prefers NITRO_PORT over PORT', async () => {
    const result = await panda(['health', '--json'], { NITRO_PORT: String(port), PORT: '1' })
    expect(result.code).toBe(0)
    expect(JSON.parse(result.stdout).url).toBe(`${base}/api/health`)
  })

  it.each([200, 302, 401, 404, 503])('retains custom --url and the non-5xx rule for HTTP %i', async (status) => {
    mocks.getActiveJob.mockReturnValue(null)
    mocks.getSiteVisibility.mockResolvedValue('public')
    customStatus = status
    const result = await panda(['health', '--json', '--url', `${base}/custom-status`], { NITRO_PORT: '1' })
    expect(result.code).toBe(status < 500 ? 0 : 1)
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: status < 500, url: `${base}/custom-status`, status })
  })

  it('can opt into DB health and exits unhealthy for its 503 response', async () => {
    const result = await panda(['health', '--json', '--url', `${base}/api/health?db=1`])
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, status: 503 })
  })

  it('retains timeout failures on custom URLs', async () => {
    mocks.getActiveJob.mockReturnValue(null)
    mocks.getSiteVisibility.mockResolvedValue('public')
    const result = await panda(['health', '--json', '--url', `${base}/hanging`, '--timeout', '0.05'])
    expect(result.code).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, status: null, detail: 'timeout after 50ms' })
  })

  it('documents the new default in help output', async () => {
    const result = await panda(['help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('default http://127.0.0.1:$PORT/api/health')
  })
})
