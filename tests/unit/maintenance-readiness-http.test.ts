import { createServer } from 'node:http'
import { createApp, createError, defineEventHandler, getRequestURL, setResponseHeader, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeBarrier } from '../../server/utils/maintenance'
import { wrapMaintenanceHandler } from '../../server/utils/maintenance-handler'

const visibility = vi.hoisted(() => vi.fn().mockRejectedValue(new Error('readiness must not contact visibility DB')))
vi.mock('../../server/utils/visibility', () => ({getSiteVisibility: visibility}))
vi.mock('../../server/utils/auth', () => ({isOwner: vi.fn()}))
const status = vi.hoisted(() => ({state: 'recovery-required', ready: false, failure: {phase: 'recovery', category: 'restore-recovery-required'}}))
vi.mock('../../server/utils/startup', () => ({startup: {status: () => status, guidance: () => ({action: 'run-recovery-assistant', recoveryRequired: true})}}))
afterEach(() => vi.unstubAllGlobals())

describe('readiness through both real maintenance layers', () => {
  it('reports startup recovery instead of the inner middleware masking readiness; no prefix exemptions', async () => {
    for (const [name, value] of Object.entries({defineEventHandler, createError, getRequestURL, setResponseHeader})) vi.stubGlobal(name, value)
    const {default: middleware} = await import('../../server/middleware/restore-maintenance')
    const {default: readiness} = await import('../../server/api/ready.get')
    const owner = {}
    await writeBarrier.close(owner)
    const app = createApp()
    app.use(middleware)
    app.use((await import('../../server/middleware/site-visibility')).default)
    app.use(defineEventHandler(event => event.path === '/api/ready' ? readiness(event) : {ok: true}))
    app.handler = wrapMaintenanceHandler(app.handler)
    const server = createServer(toNodeListener(app))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as {port: number}).port}`
    try {
      const response = await fetch(`${base}/api/ready`)
      expect(response.status).toBe(503)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('retry-after')).toBe('15')
      expect(await response.json()).toMatchObject({...status, guidance: {action: 'run-recovery-assistant', recoveryRequired: true}})
      expect((await fetch(`${base}/api/health`)).status).toBe(200)
      expect(visibility).not.toHaveBeenCalled()
      for (const path of ['/api/ready/forged', '/api/health/forged', '/__nuxt_error']) {
        expect((await fetch(`${base}${path}`)).status).toBe(503)
      }
      expect((await fetch(`${base}/api/ready`, {method: 'POST'})).status).toBe(503)
    } finally {
      writeBarrier.reopen(owner)
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
})
