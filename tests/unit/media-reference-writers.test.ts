import { beforeEach, describe, expect, it, vi } from 'vitest'
import { restorePostVersion } from '../../server/utils/blocks'
import { writeAppSettings } from '../../server/utils/settings'

const mocks = vi.hoisted(() => ({query: vi.fn(), reserve: vi.fn()}))
vi.mock('../../server/utils/db', () => ({queryDb: mocks.query, useDb: async () => ({}), queryDbRecord: vi.fn(), findBySlug: vi.fn()}))
vi.mock('../../server/utils/referenceTracker', () => ({mediaReserveReferences: mocks.reserve}))
const hash = 'a'.repeat(64), owner = {id: 'users:admin', username: 'admin'}
beforeEach(() => {vi.clearAllMocks(); mocks.query.mockResolvedValue([[]]); mocks.reserve.mockResolvedValue(undefined)})
describe('additional media reference writers (owned mocks, no configured targets)', () => {
  it('version restore refuses unavailable media before any version/block write', async () => {
    mocks.query.mockResolvedValue([[{seq: 10, out: {id: `block:${'b'.repeat(64)}`, type: 'image', node: {type: 'image', attrs: {src: `/media/${hash}`}}, text: ''}}]])
    mocks.reserve.mockRejectedValue(new Error('Media reference unavailable'))
    await expect(restorePostVersion({} as never, 'post:fixture', 'old', [], owner)).rejects.toThrow(/unavailable/)
    expect(mocks.reserve).toHaveBeenCalledWith(expect.anything(), 'post:fixture', [expect.objectContaining({type: 'doc'})], owner)
    expect(mocks.query).toHaveBeenCalledOnce()
    expect(mocks.query.mock.calls[0]![1]).toMatch(/^SELECT/)
  })
  it('public site image/settings references reserve before upsert and cannot use private media', async () => {
    mocks.reserve.mockRejectedValue(new Error('Media reference unavailable'))
    await expect(writeAppSettings({site_logo: `/media/${hash}`})).rejects.toThrow(/unavailable/)
    expect(mocks.reserve).toHaveBeenCalledWith(expect.anything(), 'app_settings:site_logo', [{value: `/media/${hash}`}])
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it('does not scan admin-only/secret setting values as media', async () => {
    await writeAppSettings({analytics_hash_salt: hash}, ['analytics_hash_salt'])
    expect(mocks.reserve).not.toHaveBeenCalled()
    expect(mocks.query).toHaveBeenCalled()
  })
})
