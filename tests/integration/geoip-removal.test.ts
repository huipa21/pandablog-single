import { readFile } from 'node:fs/promises'
import { Surreal } from 'surrealdb'
import { describe, expect, it } from 'vitest'
import { startFixture } from '../../scripts/backend-hardening/fixture'
import { removeLegacyGeoFields } from '../../server/utils/geoip-removal-migration'
import { queryRows } from '../../server/utils/surrealResult'

const LEGACY_FIELDS = `
  DEFINE FIELD country ON pageview TYPE option<string>; DEFINE FIELD region ON pageview TYPE option<string>; DEFINE FIELD city ON pageview TYPE option<string>;
  DEFINE FIELD country ON analytics_session TYPE option<string>; DEFINE FIELD city ON analytics_session TYPE option<string>;
  DEFINE FIELD geo_truncated ON analytics_daily TYPE bool DEFAULT false;
  DEFINE FIELD country ON trusted_devices TYPE option<string>;`

describe.skipIf(process.env.PB_BACKEND_FIXTURE !== '1')('GeoIP removal on stable 3.2.x', () => {
  it('unsets stored legacy geo values so SCHEMAFULL rows stay writable after their fields are removed', async () => {
    const fixture = await startFixture({enabled: process.env.PB_BACKEND_FIXTURE, binary: process.env.PB_BACKEND_SURREAL_BIN ?? ''}), db = new Surreal()
    try {
      await db.connect(`${fixture.endpoint.replace('http:', 'ws:')}/rpc`); await db.signin({username: fixture.username, password: fixture.password}); await db.use({namespace: fixture.namespace, database: fixture.database})
      const schema = await readFile('server/utils/schema.surql', 'utf8')
      await db.query(schema)
      await db.query(LEGACY_FIELDS)
      await db.query(`CREATE users:owner CONTENT {username: 'admin', password_hash: 'x'};
        CREATE pageview:legacy CONTENT {path: '/a', visitor_hash: 'h', country: 'CN', region: 'SH', city: 'Shanghai'};
        CREATE analytics_session:legacy CONTENT {visitor_hash: 'h', country: 'CN', city: 'Shanghai', pageview_count: 1};
        CREATE analytics_daily:legacy CONTENT {date: '2026-01-01', page_views: 1, unique_visitors: 1, sessions: 1, bounce_sessions: 1, total_visit_seconds: 0, geo_truncated: true};
        CREATE trusted_devices:legacy CONTENT {user: users:owner, token_hash: 't', label: 'l', ua_hash: 'u', country: 'CN', expires_at: time::now() + 1d};`)
      await db.query(schema)

      await expect(db.query('UPDATE analytics_session:legacy SET pageview_count += 1;')).rejects.toThrow(/no such field exists/)
      await removeLegacyGeoFields(db)
      await removeLegacyGeoFields(db) // idempotent

      await db.query(`UPDATE analytics_session:legacy SET pageview_count += 1;
        UPDATE pageview:legacy SET path = '/b';
        UPDATE analytics_daily:legacy SET page_views += 1;
        UPDATE trusted_devices:legacy MERGE {ip_prefix: '203.0.113.0/24'};`)
      for (const table of ['pageview', 'analytics_session', 'analytics_daily', 'trusted_devices']) {
        const row = queryRows<Record<string, unknown>>(await db.query(`SELECT * FROM ${table}:legacy;`))[0]!
        for (const field of ['country', 'region', 'city', 'geo_truncated']) expect(row).not.toHaveProperty(field)
      }
      const tables = Object.keys((await db.query<[{tables: Record<string, unknown>}]>('INFO FOR DB;'))[0].tables)
      expect(tables).not.toContain('analytics_daily_geo')
    } finally {await db.close(); await fixture.stop()}
  }, 60_000)
})
