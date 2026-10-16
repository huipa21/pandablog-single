import { describe, expect, it } from 'vitest'
import { isAnalyticsBot } from '../../server/utils/analytics/bots'
import { addUtcDays, startOfUtcDay, utcDateString } from '../../server/utils/analytics/date'
import { normalizeAnalyticsPath, normalizeAnalyticsReferrer } from '../../server/utils/analytics/path'
import { isMissingAnalyticsTableError } from '../../server/utils/analytics/tables'

describe('analytics helpers', () => {
  it('filters crawler user agents', () => {
    expect(isAnalyticsBot('Mozilla/5.0 Googlebot/2.1')).toBe(true)
    expect(isAnalyticsBot('Mozilla/5.0 Safari/605.1.15')).toBe(false)
  })

  it('normalizes public paths and rejects private surfaces', () => {
    expect(normalizeAnalyticsPath('/blog/post?utm=local')).toBe('/blog/post?utm=local')
    expect(normalizeAnalyticsPath('https://example.com/tag/vue')).toBe('/tag/vue')
    expect(normalizeAnalyticsPath('/admin')).toBeNull()
    expect(normalizeAnalyticsPath('/api/posts')).toBeNull()
  })

  it('normalizes referrer and UTC day helpers', () => {
    expect(normalizeAnalyticsReferrer('  /from  ')).toBe('/from')
    const start = startOfUtcDay(new Date('2026-06-13T18:25:00.000Z'))
    expect(utcDateString(start)).toBe('2026-06-13')
    expect(utcDateString(addUtcDays(start, -1))).toBe('2026-06-12')
  })

  it('detects missing analytics tables without matching unrelated schema errors', () => {
    expect(isMissingAnalyticsTableError(new Error("The table 'pageview' does not exist"))).toBe(true)
    expect(isMissingAnalyticsTableError(new Error("The table 'post' does not exist"))).toBe(false)
    expect(isMissingAnalyticsTableError(new Error('Database query timed out'))).toBe(false)
  })
})
