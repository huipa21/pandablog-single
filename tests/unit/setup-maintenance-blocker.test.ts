import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createApp, createError, defineEventHandler, getRequestURL, setResponseHeader, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOwnedStorage } from '../../scripts/backend-hardening/fixture'

const mocks = vi.hoisted(() => ({write: vi.fn()}))
vi.mock('../../server/utils/admin-password', () => ({adminPasswordProblem: () => '', hashAdminPassword: async () => 'synthetic-hash'}))
vi.mock('../../server/utils/activity', () => ({recordActivity: vi.fn()}))
vi.mock('../../server/utils/settings', () => ({readAdminCredentials: async () => ({setupCompleted: false}), writeAdminCredentials: mocks.write}))
vi.mock('../../server/utils/users', () => ({findUserByUsername: async () => ({id: 'users:admin', username: 'admin', auth_epoch: 'a'.repeat(48)}), toSessionUser: () => ({id: 'users:admin', username: 'admin'})}))
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules()})

describe('REV-1.2 prerequisite gap: durable setup/recovery fence', () => {
  // Receipt/lock bootstrap guard only. General writer fencing and real process
  // crash recovery still belong to REV-2.2; this is a unit restart simulation.
  it('setup must remain closed after simulated restart with an owned interrupted-restore lock and empty credential fixture', async () => {
    const owned = await createOwnedStorage()
    let server: ReturnType<typeof createServer> | undefined
    try {
      vi.resetModules()
      vi.spyOn(process, 'cwd').mockReturnValue(owned.root) // all backup lock FS is owned temp
      for (const [name, value] of Object.entries({defineEventHandler, createError, getRequestURL, setResponseHeader, replaceUserSession: async () => {}})) vi.stubGlobal(name, value)
      mocks.write.mockReset().mockResolvedValue({username: 'admin'})
      const before = await import('../../server/utils/backups/jobMutex')
      const store = new before.JobStore(join(owned.root, 'storage/backups'))
      const owner = await store.acquire({id: 'fixture-interrupted', kind: 'restore', startedAt: new Date().toISOString()})
      await store.beginRestore(owner)
      await store.transition(owner, {phase: 'db-wipe', destructive: true})
      store.progress({phase: 'db-wipe', percent: 35})
      expect(store.getActiveJob()?.progress?.phase).toBe('db-wipe')
      const journal = JSON.parse(await readFile(join(owned.root, 'storage/backups/.restore-journal.json'), 'utf8'))
      expect(journal.owner.kind).toBe('restore')
      expect(journal.phase).toBe('db-wipe') // phase IS durable now
      Reflect.deleteProperty(globalThis, Symbol.for('pandablog.maintenance.barrier'))
      vi.resetModules() // unit restart simulation, not a real process/DB restore
      const restarted = await import('../../server/utils/backups/jobMutex')
      expect(restarted.getActiveJob()).toBeNull()
      expect(await restarted.jobStore.loadJournal()).toBe(true)
      const {writeBarrier} = await import('../../server/utils/maintenance')
      writeBarrier.recoverFence()
      const {default: guard} = await import('../../server/middleware/restore-maintenance')
      const {default: setup} = await import('../../server/api/auth/setup.post')
      const app = createApp(); app.use(guard); app.use('/api/auth/setup', setup)
      server = createServer(toNodeListener(app))
      await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
      const response = await fetch(`http://127.0.0.1:${(server.address() as {port: number}).port}/api/auth/setup`, {
        method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({password: 'fixture-only-password', confirm_password: 'fixture-only-password'})
      })
      await response.arrayBuffer()
      process.stdout.write(JSON.stringify({evidence: 'REV-1.2-setup-guard-unit-H3-not-real-DB-or-process-crash', simulatedRestart: true, ownedRestoreLockRetained: true, durablePhase: true, observedSetupStatus: response.status, syntheticCredentialWrites: mocks.write.mock.calls.length}) + '\n')
      expect(response.status).toBe(503)
      expect(mocks.write).not.toHaveBeenCalled()
    } finally {
      if (server) {server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve()))}
      vi.restoreAllMocks(); await owned.cleanup()
    }
  })
})
