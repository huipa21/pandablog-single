import type { H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RetentionReport } from '../../types/logging'

const mocks = vi.hoisted(() => ({ requireOwner: vi.fn(), getLastRetentionReport: vi.fn(), runLogRetention: vi.fn() }))
vi.mock('../../server/utils/auth', () => ({ requireOwner: mocks.requireOwner }))
vi.mock('../../server/utils/log-retention', () => ({ ...mocks, LOG_RETENTION_SCHEDULE: '17 3 * * *' }))
const event = {} as H3Event
const report: RetentionReport = {
  started_at: '2026-10-04T10:00:00.000Z', finished_at: '2026-10-04T10:00:01.000Z', duration_ms: 1000,
  deleted: { activity: 1, errors: 2 }, errors: []
}

beforeEach(() => {
  vi.resetModules()
  vi.resetAllMocks()
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  mocks.requireOwner.mockResolvedValue({ id: 'users:admin', username: 'admin' })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('retention admin endpoints', () => {
  it('GET authorizes before returning the report and cron schedule', async () => {
    mocks.getLastRetentionReport.mockReturnValue(report)
    const { default: get } = await import('../../server/api/admin/logs/retention.get')
    expect(await get(event)).toEqual({ last: report, schedule: '17 3 * * *' })
    expect(mocks.requireOwner).toHaveBeenCalledExactlyOnceWith(event)
    expect(mocks.requireOwner.mock.invocationCallOrder[0]).toBeLessThan(mocks.getLastRetentionReport.mock.invocationCallOrder[0]!)
    expect(mocks.runLogRetention).not.toHaveBeenCalled()
  })

  it('GET returns null before any retention run', async () => {
    mocks.getLastRetentionReport.mockReturnValue(null)
    const { default: get } = await import('../../server/api/admin/logs/retention.get')
    expect(await get(event)).toEqual({ last: null, schedule: '17 3 * * *' })
  })

  it('POST authorizes before using the shared runner and returns its report directly', async () => {
    mocks.runLogRetention.mockResolvedValue(report)
    const { default: post } = await import('../../server/api/admin/logs/retention/run.post')
    expect(await post(event)).toBe(report)
    expect(mocks.requireOwner).toHaveBeenCalledExactlyOnceWith(event)
    expect(mocks.requireOwner.mock.invocationCallOrder[0]).toBeLessThan(mocks.runLogRetention.mock.invocationCallOrder[0]!)
    expect(mocks.runLogRetention).toHaveBeenCalledExactlyOnceWith()
  })

  it('returns per-stream errors rather than hiding a partial run behind a success summary', async () => {
    const partial = { ...report, errors: ['activity: database unavailable'] }
    mocks.runLogRetention.mockResolvedValue(partial)
    const { default: post } = await import('../../server/api/admin/logs/retention/run.post')
    expect(await post(event)).toBe(partial)
  })

  it('denies both endpoints without exposing the last report or running deletions', async () => {
    mocks.requireOwner.mockRejectedValue(new Error('Insufficient permissions'))
    const { default: get } = await import('../../server/api/admin/logs/retention.get')
    const { default: post } = await import('../../server/api/admin/logs/retention/run.post')
    await expect(get(event)).rejects.toThrow('Insufficient permissions')
    await expect(post(event)).rejects.toThrow('Insufficient permissions')
    expect(mocks.getLastRetentionReport).not.toHaveBeenCalled()
    expect(mocks.runLogRetention).not.toHaveBeenCalled()
  })
})
