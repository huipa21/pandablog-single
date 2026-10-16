import { randomUUID } from 'node:crypto'
import type { Surreal } from 'surrealdb'
import { queryDb, useDb } from '../db'
import { firstRow, queryRows } from '../surrealResult'
import { getAnalyticsSettings } from '../settings'
import { writeBarrier } from '../maintenance'
import { BoundedAdmission } from '../admission'
import { addUtcDays, startOfUtcDay, utcDateString } from './date'
import { ANALYTICS_REPAIR_DAYS, analyticsDate, analyticsResult, dailyAggregateSql } from './aggregate'

const jobs = new BoundedAdmission({active: 1, waiting: 0, waitMs: 1_000}, 'Analytics maintenance')
export const ANALYTICS_RUN_DAYS = 31
export const ANALYTICS_RETENTION_BATCH = 500
export const ANALYTICS_RETENTION_BATCHES = 20

export function rollupCompletedAnalyticsDays(now = new Date(), signal?: AbortSignal) {
  return jobs.run(() => writeBarrier.run(async () => {
    const db = await useDb(), today = startOfUtcDay(now), repairStart = addUtcDays(today, -ANALYTICS_REPAIR_DAYS)
    const state = firstRow<{next_day?: unknown}>(await queryDb(db, 'SELECT next_day FROM analytics_checkpoint:rollup;', {}, {retry: 'readOnly', label: 'analytics checkpoint'}))
    let next: Date | null
    if (state?.next_day !== undefined) next = analyticsDate(state.next_day)
    else {
      // time ordering, not math::min(datetime), and no false-empty infinity.
      const row = firstRow<{created_at?: unknown}>(await queryDb(db,
        'SELECT created_at FROM pageview WITH NOINDEX WHERE created_at < $today ORDER BY created_at ASC LIMIT 1 TIMEOUT 10s;',
        {today}, {retry: 'readOnly', label: 'analytics oldest pageview'}))
      next = row ? startOfUtcDay(analyticsDate(row.created_at)) : null
    }
    let rolledUpDays = 0
    const started = Date.now()
    while (next && next < repairStart && rolledUpDays < ANALYTICS_RUN_DAYS && Date.now() - started < 60_000 && !signal?.aborted) {
      await rollupAnalyticsDay(db, next, true, now)
      next = addUtcDays(next, 1); rolledUpDays++
    }
    // Recent days repair cross-midnight sessions/response-delayed server hits.
    // Historical progress is persisted by the SAME summary transaction.
    if (!next || next >= repairStart) {
      for (let day = repairStart; day < today && !signal?.aborted; day = addUtcDays(day, 1)) {
        await rollupAnalyticsDay(db, day, true, now); rolledUpDays++
      }
      next = today
    }
    // Inactivity sessions can remain active for many days. Their start-day
    // totals stay repairable even beyond the ordinary two-day repair window.
    const pending = queryRows<{date: string}>(await queryDb(db,
      'SELECT date FROM analytics_daily WITH NOINDEX WHERE published = true AND finalized != true AND publication_epoch IN (SELECT VALUE epoch FROM analytics_publication:current) AND date < $repairDate ORDER BY date LIMIT 31 TIMEOUT 5s;',
      {repairDate: utcDateString(repairStart)}, {label: 'analytics pending session days', retry: 'readOnly'}))
    for (const row of pending) {
      if (signal?.aborted || Date.now() - started >= 60_000) break
      await rollupAnalyticsDay(db, analyticsDate(row.date), false, now); rolledUpDays++
    }
    return {rolledUpDays, completed: !signal?.aborted && (!next || next >= today) && pending.length < 31, nextDay: next?.toISOString() ?? null}
  }, true), signal)
}

/** A bounded per-day transaction is the publication boundary. A failed rewrite
 * leaves all previous totals/page rows visible, with no staging generation.
 * Legacy days exceeding the replacement budget refuse, preserving their data.
 */
export async function rollupAnalyticsDay(db: Surreal, dayStart: Date, checkpoint = false, asOf = new Date()) {
  if (dayStart.getTime() !== startOfUtcDay(dayStart).getTime()) throw new Error('Analytics rollup requires a UTC day')
  await queryDb(db, `BEGIN TRANSACTION;
    UPSERT analytics_publication:current SET epoch = epoch ?? $epoch RETURN NONE;
    LET $publication = (SELECT epoch FROM analytics_publication:current)[0];
    ${dailyAggregateSql('$dayStart', '$dayEnd')}
    LET $open = (SELECT count() AS n FROM analytics_session WITH NOINDEX
      WHERE started_at >= $dayStart AND started_at < $dayEnd AND last_seen_at >= $idleBefore GROUP ALL TIMEOUT 5s);
    LET $pages = (SELECT path, count() AS views FROM pageview WITH NOINDEX
      WHERE created_at >= $dayStart AND created_at < $dayEnd AND string::len(path) <= 2048
      GROUP BY path ORDER BY views DESC, path LIMIT 1001 TIMEOUT 10s);
    LET $oldPages = (SELECT count() AS n FROM analytics_daily_page WHERE date = $date GROUP ALL TIMEOUT 10s);
    IF ($oldPages[0].n ?? 0) > 1000 { THROW 'Legacy analytics day exceeds atomic replacement budget; approved offline repair required'; };
    LET $keptPages = array::slice($pages, 0, 1000);
    LET $pageIds = $keptPages.map(|$row| type::record('analytics_daily_page', crypto::sha256(type::string([$date, $row.path]))));
    DELETE analytics_daily_page WHERE date = $date AND id NOT IN $pageIds RETURN NONE;
    FOR $row IN $keptPages {
      UPSERT type::record('analytics_daily_page', crypto::sha256(type::string([$date, $row.path]))) CONTENT {date: $date, path: $row.path, views: $row.views, rolled_up_at: time::now()} RETURN NONE;
    };
    LET $checkPages = (SELECT count() AS n, math::sum(views) AS views FROM analytics_daily_page WHERE date = $date GROUP ALL);
    IF ($checkPages[0].n ?? 0) != array::len($keptPages) { THROW 'Analytics summary verification failed'; };
    UPSERT type::record('analytics_daily', $date) CONTENT {
      date: $date, page_views: $totals.page_views, unique_visitors: $totals.unique_visitors,
      sessions: $totals.sessions, bounce_sessions: $totals.bounce_sessions, total_visit_seconds: $totals.total_visit_seconds,
      pages_truncated: array::len($pages) > 1000 OR ($checkPages[0].views ?? 0) < $totals.page_views,
      published: true, finalized: ($open[0].n ?? 0) = 0,
      publication_epoch: $publication.epoch, rolled_up_at: time::now()
    } RETURN NONE;
    IF $checkpoint {
      UPSERT analytics_checkpoint:rollup SET next_day = IF next_day = NONE OR next_day < $dayEnd THEN $dayEnd ELSE next_day END RETURN NONE;
    };
    COMMIT TRANSACTION;`,
  {dayStart, dayEnd: addUtcDays(dayStart, 1), date: utcDateString(dayStart), checkpoint, epoch: randomUUID(),
    idleBefore: new Date(asOf.getTime() - getAnalyticsSettings().analytics_session_window_minutes * 60_000)},
  {label: 'analytics atomic bounded publication', timeoutMs: 120_000, retry: 'never', lane: 'background'})
}

export interface AnalyticsDeletionReport {deleted: number, completed: boolean, stopReason?: 'batch-limit' | 'deadline' | 'aborted' | 'error', cutoff: string, error?: string, countKnown?: boolean}
export function cleanupAnalyticsRetention(now = new Date(), signal?: AbortSignal) {
  return jobs.run(() => writeBarrier.run(async () => {
    const settings = getAnalyticsSettings(), db = await useDb(), today = startOfUtcDay(now)
    const cutoff = addUtcDays(today, -Math.max(ANALYTICS_REPAIR_DAYS + 1, settings.analytics_retention_days))
    const idleBefore = new Date(now.getTime() - settings.analytics_session_window_minutes * 60_000)
    const reports: Record<string, AnalyticsDeletionReport> = {}
    // No summary expiry: historical metrics intentionally remain readable.
    // These two small new tables are retained only while their source survives.
    for (const table of ['pageview', 'analytics_session', 'analytics_visitor'] as const) {
      const started = Date.now()
      let deleted = 0, completed = false, stopReason: AnalyticsDeletionReport['stopReason'], errorSample: string | undefined, uncertain = false
      try {
      for (let batch = 0; batch < ANALYTICS_RETENTION_BATCHES; batch++) {
        if (signal?.aborted) {stopReason = 'aborted'; break}
        if (Date.now() - started >= 30_000) {stopReason = 'deadline'; break}
        const where = table === 'pageview'
          ? "created_at < $cutoff AND type::record('analytics_daily', time::format(created_at, '%Y-%m-%d')).published = true AND type::record('analytics_daily', time::format(created_at, '%Y-%m-%d')).finalized = true AND $publication.epoch != NONE AND type::record('analytics_daily', time::format(created_at, '%Y-%m-%d')).publication_epoch = $publication.epoch"
          : table === 'analytics_session'
            ? "started_at < $cutoff AND last_seen_at < $cutoff AND last_seen_at < $idleBefore AND type::record('analytics_daily', time::format(started_at, '%Y-%m-%d')).published = true AND type::record('analytics_daily', time::format(started_at, '%Y-%m-%d')).finalized = true AND $publication.epoch != NONE AND type::record('analytics_daily', time::format(started_at, '%Y-%m-%d')).publication_epoch = $publication.epoch"
            : 'last_seen_at < $cutoff AND last_seen_at < $idleBefore'
        // Selection and recheck/delete share a transaction. New/refreshed rows
        // cannot be deleted on a stale app-side snapshot. Only scalar count out.
        const row = analyticsResult<{deleted: number}>(await queryDb(db, `BEGIN TRANSACTION;
          LET $publication = (SELECT epoch FROM analytics_publication:current)[0];
          LET $ids = (SELECT VALUE id FROM ${table} WITH NOINDEX WHERE ${where} ORDER BY id LIMIT 500 TIMEOUT 5s);
          DELETE ${table} WHERE id IN $ids AND ${where} RETURN NONE;
          RETURN [{deleted: array::len($ids)}];
          COMMIT TRANSACTION;`, {cutoff, idleBefore}, {label: `analytics bounded retention ${table}`, timeoutMs: 15_000, retry: 'never', lane: 'background'}), 'deleted')
        if (!row || !Number.isSafeInteger(row.deleted) || row.deleted < 0 || row.deleted > ANALYTICS_RETENTION_BATCH) throw new Error('Invalid analytics retention count')
        deleted += row.deleted
        if (row.deleted < ANALYTICS_RETENTION_BATCH) {completed = true; break}
        await new Promise(resolve => setTimeout(resolve, 5))
      }
      } catch (error) {
        stopReason = 'error'
        errorSample = (error instanceof Error ? error.message : 'Analytics retention unavailable').slice(0, 200)
        uncertain = (error as {data?: {uncertain?: boolean}})?.data?.uncertain === true
      }
      reports[table] = {deleted, completed, cutoff: cutoff.toISOString(), ...(!completed ? {stopReason: stopReason ?? 'batch-limit' as const} : {}),
        ...(errorSample ? {error: errorSample, countKnown: !uncertain} : {})}
      if (uncertain) break // do not perform more deletion after ambiguous execution
    }
    // Unpublished raw days remain intact, even if retention cannot progress.
    return reports
  }, true), signal)
}

export function shutdownAnalyticsMaintenance() {return jobs.shutdown(5_000)}
