import { queryDb, type useDb } from './db'
import { queryRows } from './surrealResult'

const BATCH = 500

/** SurrealDB rejects writes to SCHEMAFULL rows that still carry a removed
 * field, so stored GeoIP values must be unset after their definitions go away.
 * Bounded pages, idempotent and safe to resume after interruption.
 */
const LEGACY_GEO_FIELDS: Array<{table: string, fields: string[]}> = [
  {table: 'pageview', fields: ['country', 'region', 'city']},
  {table: 'analytics_session', fields: ['country', 'region', 'city']},
  {table: 'analytics_daily', fields: ['geo_truncated']},
  {table: 'trusted_devices', fields: ['country']}
]

export async function removeLegacyGeoFields(db: Awaited<ReturnType<typeof useDb>>): Promise<void> {
  for (const {table, fields} of LEGACY_GEO_FIELDS) {
    const where = fields.map(field => `${field} != NONE`).join(' OR ')
    let previous = ''
    while (true) {
      const ids = queryRows<unknown>(await queryDb(db,
        `SELECT VALUE id FROM ${table} WITH NOINDEX WHERE ${where} LIMIT ${BATCH};`, undefined,
        {retryOnReconnect: false, label: `legacy geo cleanup page ${table}`, timeoutMs: 30_000}))
      if (!ids.length) break
      const page = ids.map(String).join('|')
      if (page === previous) throw new Error(`Legacy geo cleanup made no progress on ${table}; startup remains refused`)
      previous = page
      await queryDb(db, `UPDATE $ids UNSET ${fields.join(', ')} RETURN NONE;`, {ids},
        {retryOnReconnect: false, label: `legacy geo cleanup ${table}`, timeoutMs: 30_000})
    }
  }
}
