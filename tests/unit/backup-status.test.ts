import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, defineEventHandler, createError, getRequestURL, getHeader, setResponseHeader, toNodeListener } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import { JobStore } from '../../server/utils/backups/jobMutex'
import { WriteBarrier } from '../../server/utils/maintenance'

const current = vi.hoisted(() => ({store: null as JobStore | null, barrier: null as WriteBarrier | null, auth: vi.fn(), visibility: vi.fn()}))
vi.mock('../../server/utils/backups/jobMutex', async importOriginal => ({...await importOriginal(), getActiveJob: () => current.store?.getActiveJob(), get jobStore() {return current.store}}))
vi.mock('../../server/utils/maintenance', async importOriginal => ({...await importOriginal(), get writeBarrier() {return current.barrier}}))
vi.mock('../../server/utils/auth', () => ({requireOwner: current.auth, isOwner: current.auth}))
vi.mock('../../server/utils/visibility', () => ({getSiteVisibility: current.visibility}))

describe('exact job-scoped restore status on real H3', () => {
  it('bypasses unavailable DB only with the right capability; does not authorize other jobs or expose recovery secrets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pb-status-owned-')), store = new JobStore(root)
    // ImportActual above returns the real class; global store is never used for FS.
    current.store = store; current.barrier = new WriteBarrier()
    current.auth.mockReset().mockRejectedValue(new Error('no identity DB in this fixture'))
    current.visibility.mockReset().mockRejectedValue(new Error('visibility DB must not be consulted'))
    for (const [name, value] of Object.entries({defineEventHandler, createError, getRequestURL, getHeader, setResponseHeader})) vi.stubGlobal(name, value)
    let server: ReturnType<typeof createServer> | undefined
    try {
      const owner = await store.acquire({id: 'owned-restore', kind: 'restore', startedAt: new Date().toISOString()})
      const token = await store.beginRestore(owner)
      await store.transition(owner, {phase: 'db-wipe', destructive: true, artifacts: {safetySql: join(root, `.restore-${owner.token}/safety.surql`)}})
      await current.barrier.close(owner)
      const app = createApp()
      app.use((await import('../../server/middleware/restore-maintenance')).default)
      app.use((await import('../../server/middleware/site-visibility')).default)
      app.use('/api/admin/backups/status', (await import('../../server/api/admin/backups/status.get')).default)
      server = createServer(toNodeListener(app))
      await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
      const base = `http://127.0.0.1:${(server.address() as {port: number}).port}/api/admin/backups/status`
      const denied = await fetch(base, {headers: {cookie: 'nuxt-session=stale-cookie'}})
      expect(denied.status).toBe(403); await denied.arrayBuffer()
      const allowed = await fetch(base, {headers: {'X-PandaBlog-Restore-Status': token}})
      expect(allowed.status).toBe(200)
      expect(allowed.headers.get('cache-control')).toBe('private, no-store')
      const text = await allowed.text()
      expect(text).not.toContain(owner.token); expect(text).not.toContain(root); expect(text).not.toContain(token)
      expect(current.auth).not.toHaveBeenCalled(); expect(current.visibility).not.toHaveBeenCalled()
      await store.transition(owner, {state: 'committed', phase: 'finalize'})
      current.barrier.reopen(owner); await store.release(owner)
      const next = await store.acquire({id: 'unrelated-create', kind: 'create', startedAt: new Date().toISOString()})
      const finished = await fetch(base, {headers: {'X-PandaBlog-Restore-Status': token}})
      expect((await finished.json()).activeJob).toBeNull()
      await store.release(next)
    } finally {
      if (server) {server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve()))}
      vi.unstubAllGlobals(); await rm(root, {recursive: true, force: true})
    }
  })
})
