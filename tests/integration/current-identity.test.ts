import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import argon2 from 'argon2'
import { resetPassword } from '../../scripts/password-reset/operation'
import { readFile } from 'node:fs/promises'
import { createError, getCookie, setCookie, deleteCookie } from 'h3'
import { Surreal } from 'surrealdb'
import { describe, expect, it, vi } from 'vitest'
import { startFixture } from '../../scripts/backend-hardening/fixture'
import { ensureAuthEpochs } from '../../server/utils/auth-epoch-migration'
import { findAuthAccountById, findUserById, newAuthEpoch, setUserPasswordHash, updateUser } from '../../server/utils/users'
import { generate, generateSecret } from 'otplib'
import { encryptMfaSecret, decryptMfaSecret } from '../../server/utils/mfa/secret-crypto'
import { verifyTotpToken } from '../../server/utils/mfa/totp'
import { claimTotpStep, consumeRecoveryHash, disableUserMfa, enableUserMfa } from '../../server/utils/mfa/store'
import { findMatchingTrustedDevice, issueTrustedDevice, refreshTrustedDevice } from '../../server/utils/mfa/trusted-devices'

const owned = vi.hoisted(() => ({db: null as Surreal | null, interruptAfter: null as number | null}))
// Only connection/runtime plumbing is replaced. Application SQL and the
// installed SDK execute against the owned DB, never .env/configured targets.
vi.mock('../../server/utils/db', () => ({
  useDb: async () => { if (!owned.db) throw new Error('no owned DB'); return owned.db },
  queryDb: (db: Surreal, sql: string, params?: Record<string, unknown>) => {
    if (owned.interruptAfter !== null && sql.startsWith('UPDATE') && sql.includes('WHERE auth_epoch IS NONE')) {
      if (owned.interruptAfter-- === 0) {owned.interruptAfter = null; throw new Error('synthetic interruption')}
    }
    return db.query(sql, params)
  },
  queryDbRecord: async (db: Surreal, table: string, id: string) => (await db.query<[Record<string, unknown>[]]>('SELECT * FROM type::record($table, $id) LIMIT 1;', {table, id}))[0]?.[0] ?? null
}))

describe.skipIf(process.env.PB_BACKEND_FIXTURE !== '1')('real current-account security SQL', () => {
  it('password reset uses scoped existing-user-only SQL, rotates epoch and preserves active/MFA', async () => {
    const fixture = await startFixture({enabled: process.env.PB_BACKEND_FIXTURE, binary: process.env.PB_BACKEND_SURREAL_BIN ?? ''})
    const root = new Surreal(), scoped = new Surreal(), password = randomBytes(24).toString('hex'), credential = randomBytes(24).toString('hex')
    try {
      await root.connect(`${fixture.endpoint.replace('http:', 'ws:')}/rpc`, {reconnect: {enabled: false}})
      await root.signin({username: fixture.username, password: fixture.password})
      await root.use({namespace: fixture.namespace, database: fixture.database})
      const raw = await readFile('server/utils/schema.surql', 'utf8')
      await root.query(raw.slice(raw.indexOf('DEFINE TABLE OVERWRITE users'), raw.indexOf('-- ============ POST (')))
      await root.query(`DEFINE USER fixture_reset ON DATABASE PASSWORD '${credential}' ROLES EDITOR;`)
      await root.query("CREATE users:fixture CONTENT {username: 'fixture', password_hash: 'synthetic-old', active: false, auth_epoch: $epoch, totp_enabled: true, totp_secret: 'fixture-sealed'};", {epoch: 'a'.repeat(48)})
      await scoped.connect(`${fixture.endpoint.replace('http:', 'ws:')}/rpc`, {reconnect: {enabled: false}})
      await scoped.signin({namespace: fixture.namespace, database: fixture.database, username: 'fixture_reset', password: credential})
      await scoped.use({namespace: fixture.namespace, database: fixture.database})
      await resetPassword(scoped, 'fixture', password, password)
      const row = (await scoped.query<[Array<{password_hash: string, auth_epoch: string, active: boolean, totp_enabled: boolean, totp_secret: string}>]>('SELECT * FROM users:fixture;'))[0]![0]!
      expect(await argon2.verify(row.password_hash, password)).toBe(true)
      expect(row.auth_epoch).not.toBe('a'.repeat(48))
      expect(row).toMatchObject({active: false, totp_enabled: true, totp_secret: 'fixture-sealed'})
      await expect(resetPassword(scoped, 'unknown', password, password)).rejects.toMatchObject({uncertain: false})
      expect((await scoped.query<[Array<{count: number}>]>('SELECT count() AS count FROM users GROUP ALL;'))[0]![0]!.count).toBe(1)
      console.info(JSON.stringify({evidence: 'owned-scoped-reset-SQL-not-interactive-container', node: process.version, surreal: (await root.version()).version}))
    } finally {await scoped.close(); await root.close(); await fixture.stop()}
  }, 90_000)
  it('migrates idempotently after interruption; all security writers rotate; stale profile/device cannot restore epochs; recreate is fresh', async () => {
    const fixture = await startFixture({enabled: process.env.PB_BACKEND_FIXTURE, binary: process.env.PB_BACKEND_SURREAL_BIN ?? ''})
    const db = new Surreal()
    owned.db = db
    for (const [name, value] of Object.entries({createError, getCookie, setCookie, deleteCookie})) vi.stubGlobal(name, value)
    try {
      await db.connect(`${fixture.endpoint.replace('http:', 'ws:')}/rpc`)
      await db.signin({username: fixture.username, password: fixture.password})
      await db.use({namespace: fixture.namespace, database: fixture.database})
      const raw = await readFile('server/utils/schema.surql', 'utf8')
      const schema = raw.slice(raw.indexOf('DEFINE TABLE OVERWRITE users'), raw.indexOf('-- ============ POST ('))
      await db.query(schema)
      await db.query("CREATE users:legacy CONTENT {username: 'legacy', password_hash: 'synthetic', active: true};")
      await db.query("CREATE users:legacytwo CONTENT {username: 'legacytwo', password_hash: 'synthetic', active: true};")
      owned.interruptAfter = 1
      await expect(ensureAuthEpochs(db)).rejects.toThrow('synthetic interruption')
      const partial = await findUserById('users:legacy')
      await ensureAuthEpochs(db)
      if (partial?.auth_epoch) expect((await findUserById('users:legacy'))!.auth_epoch).toBe(partial.auth_epoch)
      const migrated = (await findUserById('users:legacy'))!.auth_epoch
      expect(migrated).toMatch(/^[a-f0-9]{48}$/)
      await ensureAuthEpochs(db)
      expect((await findUserById('users:legacy'))!.auth_epoch).toBe(migrated)
      const createOwner = (passwordHash: string) => db.query("CREATE users:admin CONTENT {username: 'admin', password_hash: $passwordHash, active: true, auth_epoch: $epoch};", {passwordHash, epoch: newAuthEpoch()})
      await createOwner('synthetic')
      const created = {id: 'users:admin'}
      expect(await findAuthAccountById(created.id)).toMatchObject({id: created.id, active: true})
      expect(await findAuthAccountById('users:legacy')).toBeNull()
      let epoch = (await findUserById(created.id))!.auth_epoch
      const originals = new Set([epoch])
      for (const action of [
        () => setUserPasswordHash(created.id, 'reset-synthetic'),
        () => enableUserMfa(created.id, {encryptedSecret: 'synthetic-encrypted', backupCodeHashes: ['synthetic-code'], authEpoch: epoch}),
        () => disableUserMfa(created.id, epoch)
      ]) {
        await action()
        const current = (await findUserById(created.id))!
        expect(current.auth_epoch).toMatch(/^[a-f0-9]{48}$/)
        expect(originals.has(current.auth_epoch)).toBe(false)
        epoch = current.auth_epoch; originals.add(epoch)
      }
      await expect(enableUserMfa(created.id, {encryptedSecret: 'stale-must-not-activate', backupCodeHashes: [], authEpoch: migrated})).rejects.toThrow()
      await updateUser(created.id, {display_name: 'stale profile display only'})
      expect((await findUserById(created.id))!.auth_epoch).toBe(epoch)
      await expect(setUserPasswordHash(created.id, 'must-not-commit', migrated)).rejects.toThrow()
      expect((await findUserById(created.id))!.password_hash).toBe('reset-synthetic')
      const cookieJar = new Map<string, string>()
      vi.stubGlobal('setCookie', (_event: unknown, name: string, value: string) => {cookieJar.set(name, value)})
      vi.stubGlobal('getCookie', (_event: unknown, name: string) => cookieJar.get(name))
      vi.stubGlobal('deleteCookie', (_event: unknown, name: string) => {cookieJar.delete(name)})
      const context = {userAgent: 'fixture', uaHash: 'fixture', ip: null, ipPrefix: null, country: null}
      const event = {context: {}, node: {req: Object.assign(new EventEmitter(), {aborted: false}), res: Object.assign(new EventEmitter(), {destroyed: false})}} as never
      const device = await issueTrustedDevice(event, created.id, context, epoch)
      expect(await findMatchingTrustedDevice(event, created.id)).not.toBeNull()
      const copiedDeviceCookie = cookieJar.get('pb-td')!
      await setUserPasswordHash(created.id, 'revoke-device-synthetic')
      await expect(refreshTrustedDevice(event, device, context)).rejects.toThrow()
      cookieJar.set('pb-td', copiedDeviceCookie)
      expect(await findMatchingTrustedDevice(event, created.id)).toBeNull()
      vi.stubGlobal('useRuntimeConfig', () => ({mfaSecret: 'fixture-key-source-at-least-thirty-two-characters'}))
      const secret = generateSecret(), encryptedSecret = await encryptMfaSecret(secret)
      expect(await decryptMfaSecret(encryptedSecret)).toBe(secret)
      const beforeMfa = (await findUserById(created.id))!.auth_epoch
      const mfaEpoch = await enableUserMfa(created.id, {authEpoch: beforeMfa, encryptedSecret, backupCodeHashes: ['fixture-hash-a', 'fixture-hash-b', 'fixture-hash-c']})
      const factor = {authEpoch: mfaEpoch, secret: encryptedSecret}
      const claims = await Promise.all(Array.from({length: 20}, () => consumeRecoveryHash(created.id, factor, 'fixture-hash-a')))
      expect(claims.filter(Boolean)).toHaveLength(1)
      expect(await Promise.all(['fixture-hash-b', 'fixture-hash-c'].map(hash => consumeRecoveryHash(created.id, factor, hash)))).toEqual([true, true])
      expect((await db.query<[Array<{totp_backup_codes: string[]}>]>('SELECT totp_backup_codes FROM users:admin;'))[0]?.[0]?.totp_backup_codes).toEqual([])
      const fixedTime = 1_800_000_000
      const token = await generate({secret, epoch: fixedTime})
      const step = await verifyTotpToken(secret, token, fixedTime)
      expect(step).toBe(fixedTime / 30)
      const totpClaims = await Promise.all(Array.from({length: 20}, () => claimTotpStep(created.id, factor, step!)))
      expect(totpClaims.filter(Boolean)).toHaveLength(1)
      expect(await claimTotpStep(created.id, factor, step! + 1)).toBe(true)
      expect(await claimTotpStep(created.id, factor, step!)).toBe(false)
      await db.query('UPDATE users:admin SET active = false;')
      expect(await claimTotpStep(created.id, factor, step! + 2)).toBe(false)
      const prior = (await findUserById(created.id))!.auth_epoch
      await db.query('DELETE users:admin;')
      expect(await findUserById(created.id)).toBeNull()
      await createOwner('new-synthetic')
      expect((await findUserById(created.id))!.auth_epoch).not.toBe(prior)
      process.stdout.write(JSON.stringify({evidence: 'REV-1.1-and-1.2-local-real-security-SQL-not-production', node: process.version, surreal: (await db.version()).version, sdk: '2.0.3'}) + '\n')
    } finally {owned.db = null; vi.unstubAllGlobals(); try {await db.close()} finally {await fixture.stop()} }
  }, 90_000)
})
