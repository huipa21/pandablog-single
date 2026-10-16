import { readFile } from 'node:fs/promises'
import { Surreal } from 'surrealdb'
import { describe, expect, it, vi } from 'vitest'
import { fixtureRss, startFixture } from '../../scripts/backend-hardening/fixture'
import { recordAnalyticsPageview } from '../../server/utils/analytics/session'
import { invalidateAnalyticsPublication } from '../../server/utils/analytics/publication'
import { readAnalyticsTotals } from '../../server/utils/analytics/aggregate'
import { cleanupAnalyticsRetention, rollupAnalyticsDay, rollupCompletedAnalyticsDays } from '../../server/utils/analytics/rollup'
import { getAnalyticsOverview, getAnalyticsTopPages, type AnalyticsRange } from '../../server/utils/analytics/read'
import { queryRows } from '../../server/utils/surrealResult'
import { getAnalyticsHashSalt } from '../../server/utils/settings'

let activeDb: Surreal
vi.mock('../../server/utils/db', async importOriginal => ({...await importOriginal<typeof import('../../server/utils/db')>(), useDb: async () => activeDb}))
vi.mock('../../server/utils/settings', async importOriginal => ({...await importOriginal<typeof import('../../server/utils/settings')>(), getAnalyticsSettings: () => ({analytics_retention_days: 7, analytics_session_window_minutes: 30})}))
const day = (value: string) => new Date(`${value}T00:00:00Z`)
const visitor = (value: number) => value.toString(16).padStart(64, '0')
function range(from: string, to: string, today: string): AnalyticsRange {
  const todayStart = day(today)
  return {from: day(from), to: day(to), todayStart, rollupStart: day(from), rollupEnd: todayStart, liveStart: todayStart}
}
describe.skipIf(process.env.PB_BACKEND_FIXTURE !== '1')('Phase 4 actual SDK/stable 3.2.x analytics', () => {
  it('exact scalars, atomic sessions/publication, bounded groups, checkpoints and safe raw retention', async () => {
    const fixture = await startFixture({enabled: process.env.PB_BACKEND_FIXTURE, binary: process.env.PB_BACKEND_SURREAL_BIN ?? ''}), db = new Surreal()
    activeDb = db
    try {
      await db.connect(`${fixture.endpoint.replace('http:', 'ws:')}/rpc`); await db.signin({username: fixture.username, password: fixture.password}); await db.use({namespace: fixture.namespace, database: fixture.database})
      const schema = await readFile('server/utils/schema.surql', 'utf8')
      const analytics = schema.slice(schema.indexOf('-- #module analytics start'), schema.indexOf('-- #module analytics end'))
      await db.query(analytics + '\n' + schema.slice(schema.indexOf('DEFINE TABLE OVERWRITE app_settings'), schema.indexOf('-- ============ HASH-BASED FILE LIBRARY')))
      const salts = await Promise.all(Array.from({length: 20}, () => getAnalyticsHashSalt()))
      expect(new Set(salts).size).toBe(1); expect(salts[0]).toHaveLength(64)
      const saltRow = queryRows<{key: string}>(await db.query('SELECT key FROM app_settings;'))[0]!
      await db.query('DELETE app_settings RETURN NONE; CREATE app_settings:legacy CONTENT {key: $key, value: $salt};', {key: saltRow.key, salt: 'legacy'.repeat(8)})
      expect(await getAnalyticsHashSalt()).toBe('legacy'.repeat(8))
      const now = new Date('2026-01-01T23:59:50.100Z')
      await Promise.all(Array.from({length: 20}, () => recordAnalyticsPageview(db, visitor(1), now, 30, {path: '/blog/a'})))
      expect(queryRows(await db.query('SELECT id FROM analytics_session;'))).toHaveLength(1)
      await recordAnalyticsPageview(db, visitor(1), new Date('2026-01-02T00:00:10.400Z'), 30, {path: '/blog/b'})
      await recordAnalyticsPageview(db, visitor(1), new Date('2026-01-01T23:59:55Z'), 30, {path: '/blog/a'})
      await recordAnalyticsPageview(db, visitor(2), new Date('2026-01-01T12:00:00Z'), 30, {path: '/blog/b'})
      await expect(recordAnalyticsPageview(db, visitor(1), day('2026-01-01'), 30, {path: '/too-late'})).rejects.toThrow(/repair window/)
      expect(await readAnalyticsTotals(db, day('2026-01-01'), day('2026-01-02'))).toEqual({page_views: 22, unique_visitors: 2, sessions: 2, bounce_sessions: 1, total_visit_seconds: 20})
      const session = queryRows<{last_seen_at: unknown, pageview_count: number}>(await db.query('SELECT last_seen_at, pageview_count FROM analytics_session WHERE visitor_hash = $hash;', {hash: visitor(1)}))[0]!
      expect(String(session.last_seen_at)).toContain('00:00:10.4'); expect(session.pageview_count).toBe(22)
      const plan = await db.query('SELECT id, last_seen_at FROM analytics_session WITH NOINDEX WHERE visitor_hash = $hash ORDER BY last_seen_at DESC, id ASC LIMIT 1 EXPLAIN FULL;', {hash: visitor(1)})
      await db.query("CREATE analytics_daily_page:legacy SET date = '2026-01-01', path = '/blog/a', views = 999;")
      await rollupAnalyticsDay(db, day('2026-01-01'))
      await rollupAnalyticsDay(db, day('2026-01-01')) // idempotent replacement
      const historical = range('2026-01-01', '2026-01-02', '2026-01-02')
      historical.liveStart = historical.to
      const overview = await getAnalyticsOverview(historical)
      expect(overview.scorecards).toMatchObject({pageViews: 22, uniqueVisitors: 2, sessions: 2, bounceRate: 0.5, avgVisitSeconds: 10})
      expect((await getAnalyticsTopPages(historical, 10)).pages).toEqual([{path: '/blog/a', views: 21}, {path: '/blog/b', views: 1}])
      // Force a failed publication after mutations; transaction rollback keeps
      // all previously complete summaries readable, not just daily totals.
      const published = await db.query('SELECT * FROM analytics_daily; SELECT * FROM analytics_daily_page;')
      await db.query('DEFINE FIELD OVERWRITE published ON analytics_daily TYPE bool ASSERT $value = false;')
      await expect(rollupAnalyticsDay(db, day('2026-01-01'))).rejects.toThrow()
      expect(await db.query('SELECT * FROM analytics_daily; SELECT * FROM analytics_daily_page;')).toEqual(published)
      await db.query('DEFINE FIELD OVERWRITE published ON analytics_daily TYPE bool DEFAULT false;')
      const first = await rollupCompletedAnalyticsDays(day('2026-01-04'))
      const second = await rollupCompletedAnalyticsDays(day('2026-01-04'))
      expect(first.completed).toBe(true); expect(second.rolledUpDays).toBe(2)
      await invalidateAnalyticsPublication(db)
      expect((await getAnalyticsOverview(historical)).partial).toBe(true)
      expect((await cleanupAnalyticsRetention(day('2026-01-20'))).pageview?.deleted).toBe(0)
      await rollupCompletedAnalyticsDays(day('2026-01-04')) // restore repair: raw-backed days only
      // Unpublished old events and active cross-midnight sessions survive.
      await db.query("CREATE pageview:unpublished CONTENT {path: '/', visitor_hash: 'old', created_at: $date}; CREATE analytics_session:active CONTENT {visitor_hash: 'active', started_at: $date, last_seen_at: $now, pageview_count: 1};", {date: day('2025-01-01'), now: day('2026-01-20')})
      const reports = await cleanupAnalyticsRetention(day('2026-01-20'))
      expect(reports.pageview?.deleted).toBe(23)
      expect(queryRows(await db.query('SELECT id FROM pageview:unpublished;'))).toHaveLength(1)
      expect(queryRows(await db.query('SELECT id FROM analytics_session:active;'))).toHaveLength(1)
      // 10x raw growth, fixed scalar shape; seed in finite 100-row batches.
      const samples = []
      for (const size of [100, 1000, 2000]) {
        await db.query('DELETE pageview WHERE created_at >= $date RETURN NONE;', {date: day('2026-02-01')})
        for (let batch = 0; batch < size / 100; batch++) await db.query('INSERT INTO pageview $rows RETURN NONE;', {rows: Array.from({length: 100}, (_, index) => ({path: `/p/${batch * 100 + index}`, visitor_hash: visitor(batch * 100 + index), created_at: day('2026-02-01')}))})
        const before = process.memoryUsage(), start = performance.now(), totals = await readAnalyticsTotals(db, day('2026-02-01'), day('2026-02-02'))
        expect(totals.page_views).toBe(size); expect(totals.unique_visitors).toBe(size)
        const elapsedMs = performance.now() - start
        samples.push({size, before, after: process.memoryUsage(), dbRss: await fixtureRss(fixture.pid), elapsedMs, encodedBytes: Buffer.byteLength(JSON.stringify(totals))})
      }
      await rollupAnalyticsDay(db, day('2026-02-01'))
      expect(queryRows(await db.query("SELECT id FROM analytics_daily_page WHERE date = '2026-02-01';"))).toHaveLength(1000)
      const top = await getAnalyticsTopPages(range('2026-02-01', '2026-02-02', '2026-02-02'), 10)
      expect(top.truncated).toBe(true); expect(top.pages).toHaveLength(10)
      process.stdout.write(JSON.stringify({evidence: 'REV-4.1/4.2-owned-analytics', version: await db.version(), samples, sessionPlan: plan}) + '\n')
    } finally {await db.close(); await fixture.stop()}
  }, 120_000)
})
