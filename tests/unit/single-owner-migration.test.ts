import { afterEach, describe, expect, it, vi } from 'vitest'
import { collapseToSingleOwner } from '../../server/utils/single-owner-migration'
const query = vi.hoisted(() => vi.fn())
vi.mock('../../server/utils/db', () => ({queryDb: query}))

describe('single-owner migration', () => {
  afterEach(() => {query.mockReset(); vi.restoreAllMocks()})

  it('refuses to delete accounts when the owner record is missing', async () => {
    query.mockResolvedValueOnce([[], ['alice']])
    await expect(collapseToSingleOwner({} as never)).rejects.toThrow(/requires users:admin/)
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('runs atomically and reports removed accounts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    query.mockResolvedValueOnce([['users:admin'], ['alice', 'bob']]).mockResolvedValueOnce([])
    await expect(collapseToSingleOwner({} as never)).resolves.toEqual({removedUsers: ['alice', 'bob']})
    const sql = String(query.mock.calls[1]![1])
    expect(sql.trim()).toMatch(/^BEGIN TRANSACTION;[\s\S]*COMMIT TRANSACTION;$/)
    expect(sql.indexOf('password_owner.password_hash')).toBeLessThan(sql.indexOf('REMOVE FIELD IF EXISTS password_owner'))
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('alice, bob'))
  })

  it('migrates an empty or owner-only database without warnings', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    query.mockResolvedValueOnce([[], []]).mockResolvedValueOnce([])
    await expect(collapseToSingleOwner({} as never)).resolves.toEqual({removedUsers: []})
    expect(query).toHaveBeenCalledTimes(2)
    expect(warn).not.toHaveBeenCalled()
  })
})
