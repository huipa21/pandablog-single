import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mediaDashboard } from '../../server/utils/media-dashboard'
const query = vi.hoisted(() => vi.fn())
vi.mock('../../server/utils/db', () => ({queryDb: query}))
const user = {id: 'users:admin', username: 'admin'}
const range = {range: 'all', start: null, end: new Date('2026-10-06')}
beforeEach(() => query.mockReset())
describe('bounded scoped media dashboard', () => {
  it('keeps exact summary/types and existing empty response shapes', async () => {
    query.mockResolvedValue([[], [], [], [], [], []])
    const result = await mediaDashboard({} as never, user, range, 1024)
    expect(result.summary).toEqual({total_items: 0, total_storage: 0, average_size: 0})
    expect(result.by_type).toHaveLength(6)
    expect(result.orphans).toEqual({count: 0, files: []})
    expect(result.time_insights).toMatchObject({range: 'all', start: null, uploaded_items: 0})
  })
  it('uses scalar aggregates and at most ten rows per list, filtering before projection', async () => {
    query.mockResolvedValue([[{total: 5, storage: 1000, oversized_count: 2, orphan_count: 1}], [{type: 'image', count: 5, storage: 1000}], [], [], [], []])
    const result = await mediaDashboard({} as never, user, {...range, range: 'custom', start: new Date('2024-01-01')}, 1024)
    expect(result.summary).toEqual({total_items: 5, total_storage: 1000, average_size: 200})
    const sql = query.mock.calls[0]![1] as string
    expect(sql).toContain('math::sum(size)'); expect(sql).toContain('GROUP ALL')
    expect(sql).toContain('array::len(referenced_by) AS referenced_by_count')
    expect(sql.match(/LIMIT 10/g)).toHaveLength(4)
    expect(sql).toContain("visibility IN ['public', 'private']"); expect(sql).toContain('uploaded_at >= $from')
    expect(sql).not.toMatch(/SELECT \*|reference_count, referenced_by,/)
  })
  it('does not turn absent/malformed counts into zero', async () => {
    query.mockResolvedValue([[{total: NaN}], [], [], [], [], []])
    await expect(mediaDashboard({} as never, user, range, 1024)).rejects.toThrow(/unavailable/)
    query.mockResolvedValue([[]])
    await expect(mediaDashboard({} as never, user, range, 1024)).rejects.toThrow(/unavailable/)
  })
  it('rejects nonfinite thresholds before SQL', async () => {
    await expect(mediaDashboard({} as never, user, range, Infinity)).rejects.toThrow(/budget/)
    expect(query).not.toHaveBeenCalled()
  })
})
