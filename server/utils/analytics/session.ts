import type { Surreal } from 'surrealdb'
import { queryDb } from '../db'
import { stringifyRecordId } from '../surrealResult'
import { analyticsResult } from './aggregate'
import { BoundedAdmission } from '../admission'
import { writeBarrier } from '../maintenance'

const tracking = new BoundedAdmission({active: 1, waiting: 32, waitMs: 2_000}, 'Analytics tracking')

/** The deterministic visitor head is a DB conflict point, including competing
 * first hits. Session count + pageview insertion commit together. No timeout or
 * transport replay: only confirmed transaction conflicts may retry.
 */
export function recordAnalyticsPageview(db: Surreal, visitorHash: string, now: Date, sessionWindowMinutes: number, pageview: {path: string, referrer?: string}) {
  if (!/^[a-f0-9]{64}$/.test(visitorHash) || !Number.isInteger(sessionWindowMinutes) || sessionWindowMinutes < 5 || sessionWindowMinutes > 1440
    || !Number.isFinite(now.getTime()) || Buffer.byteLength(pageview.path) > 2048 || Buffer.byteLength(pageview.referrer ?? '') > 2048) throw new Error('Invalid analytics event')
  return tracking.run(() => writeBarrier.run(async () => {
    const cutoff = new Date(now.getTime() - sessionWindowMinutes * 60_000)
    for (let attempt = 0; ; attempt++) {
      try {
        const row = analyticsResult<{session: unknown}>(await queryDb(db, `BEGIN TRANSACTION;
          LET $head = type::record('analytics_visitor', $visitorHash);
          LET $headState = (SELECT last_seen_at FROM $head LIMIT 1)[0];
          IF $headState.last_seen_at != NONE AND $headState.last_seen_at > $latestAcceptable { THROW 'Analytics event exceeds the server-arrival repair window'; };
          LET $prior = (SELECT id, last_seen_at FROM analytics_session WITH NOINDEX
            WHERE visitor_hash = $visitorHash AND last_seen_at >= $cutoff
            ORDER BY last_seen_at DESC, id ASC LIMIT 1 TIMEOUT 5s)[0];
          LET $analyticsSession = IF $prior.id != NONE THEN $prior.id ELSE type::record('analytics_session', rand::ulid()) END;
          IF $prior.id != NONE {
            UPDATE $analyticsSession SET last_seen_at = IF last_seen_at < $now THEN $now ELSE last_seen_at END,
              pageview_count += 1 RETURN NONE;
          } ELSE {
            CREATE $analyticsSession CONTENT {visitor_hash: $visitorHash, started_at: $now, last_seen_at: $now,             pageview_count: 1} RETURN NONE;
          };
          UPSERT $head SET last_seen_at = IF last_seen_at = NONE OR last_seen_at < $now THEN $now ELSE last_seen_at END RETURN NONE;
          CREATE pageview CONTENT {path: $path, referrer: $referrer ?? NONE, visitor_hash: $visitorHash, session: $analyticsSession,           created_at: $now} RETURN NONE;
          RETURN [{session: $analyticsSession}];
          COMMIT TRANSACTION;`,
        {visitorHash, now, cutoff, latestAcceptable: new Date(now.getTime() + sessionWindowMinutes * 60_000), path: pageview.path, referrer: pageview.referrer ?? null}, {label: 'analytics atomic event/session', timeoutMs: 20_000, retry: 'never'}), 'session')
        if (!row?.session) throw new Error('Analytics event has no committed session')
        return stringifyRecordId(row.session)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (attempt >= 3 || !/transaction.*conflict|transaction.*can be retried/i.test(message)) throw error
        await new Promise(resolve => setTimeout(resolve, 5 * (attempt + 1)))
      }
    }
  }))
}
export function shutdownAnalyticsTracking() {return tracking.shutdown(5_000)}
