import type { H3Event } from 'h3'
import { createError, getQuery } from 'h3'
import type { Surreal } from 'surrealdb'
import { queryDb, useDb } from '../db'
import { firstRow, queryRows } from '../surrealResult'
import { addUtcDays, startOfUtcDay, utcDateString } from './date'
import { ANALYTICS_GROUP_LIMIT, ANALYTICS_MAX_RANGE_DAYS, readAnalyticsTotals } from './aggregate'

export interface AnalyticsOverviewResponse {
  range: { from: string, to: string }
  partial: boolean
  scorecards: { pageViews: number, uniqueVisitors: number, uniqueVisitorsApproximate: boolean, sessions: number, bounceRate: number, avgVisitSeconds: number }
  timeseries: Array<{date: string, pageViews: number, uniqueVisitors: number, sessions: number, bounceRate: number, avgVisitSeconds: number}>
}
export interface AnalyticsTopPage {path: string, views: number}
interface DailyRow {date: string, page_views: number, unique_visitors: number, sessions: number, bounce_sessions: number, total_visit_seconds: number, pages_truncated?: boolean, finalized?: boolean, verified?: boolean}
export interface AnalyticsRange {from: Date, to: Date, todayStart: Date, rollupStart: Date, rollupEnd: Date, liveStart: Date}

export function parseAnalyticsRange(event: H3Event): AnalyticsRange {
  const query = getQuery(event), todayStart = startOfUtcDay(new Date())
  const preset = query.range ?? '7d'
  if (typeof preset !== 'string' || !['today', '7d', '30d', 'custom'].includes(preset)) invalidRange()
  const from = parseDate(query.from) ?? (preset === 'today' ? todayStart : addUtcDays(todayStart, preset === '30d' ? -29 : -6))
  const to = parseDate(query.to) ?? addUtcDays(todayStart, 1)
  if (to <= from || to.getTime() - from.getTime() > ANALYTICS_MAX_RANGE_DAYS * 86_400_000 || to > addUtcDays(todayStart, 1)) invalidRange()
  return {from, to, todayStart,
    rollupStart: from < todayStart ? from : todayStart,
    rollupEnd: to < todayStart ? to : todayStart,
    liveStart: to > todayStart ? new Date(Math.max(from.getTime(), todayStart.getTime())) : to}
}
function invalidRange(): never {throw createError({statusCode: 400, message: 'Invalid analytics range (maximum 366 UTC days)'})}
function parseDate(value: unknown) {
  if (value === undefined) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalidRange()
  const date = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(date.getTime()) || utcDateString(date) !== value) invalidRange()
  return date
}
export function parseAnalyticsLimit(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw createError({statusCode: 400, message: 'Invalid analytics limit'})
  return number
}
async function dailyRows(db: Surreal, range: AnalyticsRange) {
  if (range.rollupStart >= range.rollupEnd) return []
  const publication = firstRow<{epoch: string}>(await queryDb(db, 'SELECT epoch FROM analytics_publication:current;', {}, {label: 'analytics publication epoch', retry: 'readOnly'}))
  return queryRows<DailyRow>(await queryDb(db, `SELECT date, page_views, unique_visitors, sessions, bounce_sessions, total_visit_seconds, pages_truncated, finalized, (publication_epoch != NONE AND publication_epoch = $epoch) AS verified
    FROM analytics_daily WITH NOINDEX WHERE date >= $fromDate AND date < $toDate ORDER BY date LIMIT 366 TIMEOUT 10s;`,
  {fromDate: utcDateString(range.rollupStart), toDate: utcDateString(range.rollupEnd), epoch: publication?.epoch ?? null}, {label: 'analytics bounded daily summaries', retry: 'readOnly'}))
}
export async function getAnalyticsOverview(range: AnalyticsRange): Promise<AnalyticsOverviewResponse> {
  const db = await useDb(), rows = await dailyRows(db, range)
  // Missing historical days are explicitly partial, never an exact zero claim.
  const expected = Math.max(0, (range.rollupEnd.getTime() - range.rollupStart.getTime()) / 86_400_000)
  const partial = rows.length < expected || rows.some(row => row.finalized !== true || row.verified !== true)
  if (range.liveStart < range.to) rows.push({date: utcDateString(range.liveStart), ...await readAnalyticsTotals(db, range.liveStart, range.to)})
  const totals = {page_views: 0, unique_visitors: 0, sessions: 0, bounce_sessions: 0, total_visit_seconds: 0}
  const timeseries = rows.map(row => {
    for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += finiteCount(row[key])
    return {date: row.date, pageViews: finiteCount(row.page_views), uniqueVisitors: finiteCount(row.unique_visitors), sessions: finiteCount(row.sessions),
      bounceRate: ratio(row.bounce_sessions, row.sessions), avgVisitSeconds: Math.round(ratio(row.total_visit_seconds, row.sessions))}
  }).sort((a, b) => a.date.localeCompare(b.date))
  return {range: {from: range.from.toISOString(), to: range.to.toISOString()}, partial, scorecards: {
    pageViews: totals.page_views, uniqueVisitors: totals.unique_visitors, uniqueVisitorsApproximate: timeseries.length > 1,
    sessions: totals.sessions, bounceRate: ratio(totals.bounce_sessions, totals.sessions), avgVisitSeconds: Math.round(ratio(totals.total_visit_seconds, totals.sessions))}, timeseries}
}

/** Each source contributes at most 1000 groups. Missing groups/summary caps are
 * disclosed. Counts in a truncated mixed-source result are lower bounds; no
 * claim of an exact global top-K is made in that case.
 */
export async function getAnalyticsTopPages(range: AnalyticsRange, limit: number) {
  parseAnalyticsLimit(limit, 10, 50)
  const db = await useDb(), counts = new Map<string, number>(), summaries = await dailyRows(db, range)
  let truncated = summaries.some(row => row.pages_truncated === true)
  let partial = summaries.some(row => row.verified !== true) || summaries.length < Math.max(0, (range.rollupEnd.getTime() - range.rollupStart.getTime()) / 86_400_000)
  for (const source of ['summary', 'raw'] as const) {
    if (source === 'summary' && range.rollupStart >= range.rollupEnd || source === 'raw' && range.liveStart >= range.to) continue
    const grouped = source === 'summary'
      ? `SELECT path, math::sum(views) AS views FROM analytics_daily_page WITH NOINDEX WHERE date >= $fromDate AND date < $toDate
          GROUP BY path ORDER BY views DESC, path LIMIT 1001 TIMEOUT 10s`
      : `SELECT path, count() AS views FROM pageview WITH NOINDEX WHERE created_at >= $from AND created_at < $to
          GROUP BY path ORDER BY views DESC, path LIMIT 1001 TIMEOUT 10s`
    const rows = queryRows<AnalyticsTopPage & {oversized: boolean}>(await queryDb(db,
      `SELECT string::slice(path, 0, 2048) AS path, views, string::len(path) > 2048 AS oversized FROM (${grouped}) TIMEOUT 10s;`,
    {fromDate: utcDateString(range.rollupStart), toDate: utcDateString(range.rollupEnd), from: range.liveStart, to: range.to}, {label: `analytics bounded top pages ${source}`, retry: 'readOnly'}))
    truncated ||= rows.length > ANALYTICS_GROUP_LIMIT
    for (const row of rows.slice(0, ANALYTICS_GROUP_LIMIT)) {
      // Legacy path payloads are not allowed to inflate retained response bytes.
      if (row.oversized || typeof row.path !== 'string' || Buffer.byteLength(row.path) > 2048) {partial = true; continue}
      counts.set(row.path, (counts.get(row.path) ?? 0) + finiteCount(row.views))
    }
  }
  return {pages: Array.from(counts, ([path, views]) => ({path, views})).sort((a, b) => b.views - a.views || a.path.localeCompare(b.path)).slice(0, limit), truncated, partial}
}
function finiteCount(value: unknown) {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error('Invalid analytics count')
  return value as number
}
function ratio(value: number, total: number) {return total > 0 ? finiteCount(value) / finiteCount(total) : 0}
