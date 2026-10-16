import { writeFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { createOwnedStorage } from '../../scripts/backend-hardening/fixture'
import { SetupAuthority } from '../../server/utils/setup-authority'
const query = vi.hoisted(() => vi.fn())
vi.mock('../../server/utils/db', () => ({queryDb: query}))
vi.mock('../../server/utils/backups/jobMutex', async importOriginal => ({...await importOriginal(), getActiveJob: () => null}))

describe('one-time setup persistent authority (owned fixtures)', () => {
  it('ordinary job crash/corruption does not fence the required boot probe or reopen setup', async () => {
    const owned = await createOwnedStorage()
    try {
      await writeFile(owned.path('.job.lock'), 'ordinary partially published job record')
      query.mockResolvedValue([[{id: 'users:admin', active: true}], []])
      const authority = new SetupAuthority(owned.path('authority.json'), owned.path('.job.lock'))
      expect(await authority.status({} as never)).toEqual({completed: true, recoveryRequired: false})
      await expect(authority.reserve({} as never)).rejects.toMatchObject({statusCode: 409})
    } finally {await owned.cleanup()}
  })
  it('exclusive reservation yields one winner, restart never reopens empty DB, verified lost response reconciles', async () => {
    const owned = await createOwnedStorage()
    const path = owned.path('authority.json'), lock = owned.path('maintenance.lock')
    query.mockResolvedValue([[], []])
    const authority = new SetupAuthority(path, lock)
    try {
      const results = await Promise.allSettled([authority.reserve({} as never), authority.reserve({} as never)])
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      const winner = (results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof authority.reserve>>>).value
      expect((results.find(result => result.status === 'rejected') as PromiseRejectedResult).reason.statusCode).toBe(409)
      const restarted = new SetupAuthority(path, lock)
      expect(await restarted.status({} as never)).toEqual({completed: true, recoveryRequired: true})
      await expect(restarted.reserve({} as never)).rejects.toMatchObject({statusCode: 503})
      query.mockImplementation(async (_db, sql: string) => sql.includes('one-time') ? [] : sql.includes('SELECT id, active') ? [[{id: 'users:admin', active: true}], []] : [[{id: 'users:admin'}], [{id: 'app_settings:claim'}]])
      expect(await restarted.status({} as never)).toEqual({completed: true, recoveryRequired: false})
      query.mockResolvedValue([[], []]) // restore emptied both tables, removed all DB evidence
      expect(await restarted.status({} as never)).toEqual({completed: true, recoveryRequired: true})
      await expect(restarted.reserve({} as never)).rejects.toMatchObject({statusCode: 503})
      expect(winner.claim).toMatch(/^[a-f0-9]{48}$/)
    } finally {await owned.cleanup()}
  })
  it('corrupt/missing commit/restore/outage states refuse instead of inferring fresh setup', async () => {
    const owned = await createOwnedStorage()
    const path = owned.path('authority.json'), lock = owned.path('maintenance.lock')
    const authority = new SetupAuthority(path, lock)
    try {
      await writeFile(path, 'corrupt', {flag: 'wx'})
      query.mockResolvedValue([[], []])
      await expect(authority.status({} as never)).rejects.toMatchObject({statusCode: 503})
      await writeFile(owned.path('.job.lock'), JSON.stringify({kind: 'restore'}), {flag: 'wx'})
      await expect(authority.assertNoMaintenance()).rejects.toMatchObject({statusCode: 503})
      const other = new SetupAuthority(owned.path('other-authority.json'), owned.path('absent.lock'))
      query.mockRejectedValue(new Error('isolated DB unavailable'))
      await expect(other.status({} as never)).rejects.toMatchObject({statusCode: 503})
    } finally {await owned.cleanup()}
  })
})
