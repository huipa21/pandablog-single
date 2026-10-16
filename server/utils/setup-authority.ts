import { writeBarrier } from './maintenance'
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createError } from 'h3'
import { queryDb, type useDb } from './db'
import { firstRow, queryRows, stringifyRecordId } from './surrealResult'
import { newAuthEpoch } from './users'
import { getActiveJob, inspectRestoreState } from './backups/jobMutex'

type Database = Awaited<ReturnType<typeof useDb>>

// Windows refuses to replace a file that another handle (a concurrent read, an
// antivirus scan) briefly has open, failing with EPERM/EBUSY/EACCES. Those
// errors are transient, so retry a few times with backoff before giving up.
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const RENAME_RETRIES = 6
async function renameReplacing(from: string, to: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (process.platform !== 'win32' || attempt >= RENAME_RETRIES || !code || !TRANSIENT_RENAME_CODES.has(code)) throw error
      await new Promise(resolve => setTimeout(resolve, 10 * 2 ** attempt))
    }
  }
}
interface Receipt {version: 1, state: 'reserved' | 'closed', claim: string, epoch: string}
export interface SetupReservation {readonly claim: string, readonly epoch: string}
const evidenceSql = `SELECT id, active FROM users WHERE username = 'admin' LIMIT 1;
  SELECT key, \`value\` FROM app_settings WHERE key IN ['setup_completed', 'admin_password_hash', '__setup_claim'] LIMIT 3;`

/** Monotonic one-time bootstrap authority OUTSIDE the database that restore
 * wipes. This is not a restore journal or a general writer barrier (REV-2.2).
 * Missing/corrupt/reserved receipts never reopen an initialized owner.
 */
export class SetupAuthority {
  private readonly capabilities = new WeakSet<SetupReservation>()
  private reservedClaim: string | null = null
  private publishing?: Promise<void>
  private reserving = false
  constructor(private readonly path: string, private readonly restoreLock: string) {}
  private unavailable(message = 'Setup recovery is required') {return createError({statusCode: 503, message})}
  private async read(): Promise<Receipt | null> {
    try {
      if (!(await lstat(this.path)).isFile()) throw this.unavailable()
      const file = await open(this.path, 'r')
      try {
        const buffer = Buffer.alloc(1025), {bytesRead} = await file.read(buffer, 0, buffer.length, 0)
        if (bytesRead > 1024) throw this.unavailable()
        const data = JSON.parse(buffer.subarray(0, bytesRead).toString()) as Receipt
        if (data.version !== 1 || !['reserved', 'closed'].includes(data.state) || !/^[a-f0-9]{48}$/.test(data.claim) || !/^[a-f0-9]{48}$/.test(data.epoch)) throw this.unavailable()
        return data
      } finally {await file.close()}
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw this.unavailable()
    }
  }
  private async syncParent() {
    let directory
    try {directory = await open(dirname(this.path), 'r'); await directory.sync()}
    catch (error) {
      // Windows does not expose directory fsync through this API; file sync
      // and process-crash refusal are tested locally, Linux power-loss gates
      // remain mandatory. Never suppress real directory IO errors on POSIX.
      if (process.platform !== 'win32' || !['EPERM', 'EISDIR', 'EINVAL', 'EACCES'].includes(String((error as NodeJS.ErrnoException).code))) throw error
    } finally {await directory?.close()}
  }
  private async exclusive(receipt: Receipt) {
    await mkdir(dirname(this.path), {recursive: true, mode: 0o700})
    const file = await open(this.path, 'wx', 0o600)
    try {await file.writeFile(JSON.stringify(receipt)); await file.sync()} finally {await file.close()}
    await this.syncParent()
  }
  async assertNoMaintenance() {
    if (getActiveJob()?.kind === 'restore') throw this.unavailable('Setup is unavailable during maintenance')
    // Ordinary abandoned job ownership must not become a startup latch through
    // the required setup-authority boot probe. The monotonic setup receipt is
    // independent and unchanged; only actual/ambiguous restore fences this lane.
    const state = await inspectRestoreState(dirname(this.restoreLock))
    if (state.recovery || (state.journal?.state === 'running' && !state.journal.destructive)) throw this.unavailable('Setup is unavailable during interrupted restore')
  }
  private async evidence(db: Database): Promise<{initialized: boolean, ownerReady: boolean}> {
    try {
      const rows = await queryDb(db, evidenceSql, undefined, {retryOnReconnect: false, label: 'one-time setup evidence'})
      const owner = firstRow<{id?: unknown, active?: boolean}>(rows)
      let initialized = Boolean(owner)
      for (const row of queryRows<{key: string, value?: unknown}>(rows, 1)) {
        if (row.key === 'setup_completed') {
          if (typeof row.value !== 'boolean') throw this.unavailable()
          initialized ||= row.value
        } else if (row.key === '__setup_claim') {
          if (typeof row.value !== 'string' || !/^[a-f0-9]{48}$/.test(row.value)) throw this.unavailable()
          initialized = true
        } else if (row.key === 'admin_password_hash') {
          if (row.value !== undefined && row.value !== null && typeof row.value !== 'string') throw this.unavailable()
          initialized ||= Boolean(row.value)
        }
      }
      return {initialized, ownerReady: owner?.active === true && stringifyRecordId(owner.id) === 'users:admin'}
    } catch {throw this.unavailable('Setup state unavailable')}
  }
  async status(db: Database): Promise<{completed: boolean, recoveryRequired: boolean}> {
    await this.assertNoMaintenance()
    if (this.reserving) return {completed: true, recoveryRequired: false}
    return this.probeStatus(db)
  }
  private async probeStatus(db: Database): Promise<{completed: boolean, recoveryRequired: boolean}> {
    await this.assertNoMaintenance()
    const receipt = await this.read()
    const {initialized, ownerReady} = await this.evidence(db) // DB outage is always 503, never available setup
    if (!receipt && initialized) {
      try {await this.exclusive({version: 1, state: 'closed', claim: randomBytes(24).toString('hex'), epoch: newAuthEpoch()})}
      catch (error) {if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw this.unavailable()}
      return {completed: true, recoveryRequired: !ownerReady}
    }
    if (receipt?.state === 'reserved' && initialized && receipt.claim !== this.reservedClaim) {
      const rows = await queryDb(db, `SELECT id FROM users:admin WHERE auth_epoch = $epoch;
        SELECT id FROM app_settings WHERE key = '__setup_claim' AND \`value\` = $claim LIMIT 1;`,
      {epoch: receipt.epoch, claim: receipt.claim}, {retryOnReconnect: false, label: 'setup receipt commit verification'})
      if (firstRow(rows) && firstRow(rows, 1)) {await this.publishClosed(receipt); return {completed: true, recoveryRequired: !ownerReady}}
    }
    return {completed: Boolean(receipt) || initialized, recoveryRequired: (receipt?.state === 'reserved' && receipt.claim !== this.reservedClaim) || Boolean(receipt?.state === 'closed' && (!initialized || !ownerReady))}
  }
  async reserve(db: Database): Promise<SetupReservation> {
    if (this.reserving) throw createError({statusCode: 409, message: 'Setup has already been claimed'})
    this.reserving = true
    try {
      const status = await this.probeStatus(db)
      if (status.completed) throw createError({statusCode: status.recoveryRequired ? 503 : 409, message: status.recoveryRequired ? 'Setup recovery is required' : 'Admin setup has already been completed'})
      const reservation = Object.freeze({claim: randomBytes(24).toString('hex'), epoch: newAuthEpoch()})
      try {await this.exclusive({version: 1, state: 'reserved', ...reservation})}
      catch (error) {if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw createError({statusCode: 409, message: 'Setup has already been claimed'}); throw this.unavailable()}
      this.reservedClaim = reservation.claim
      this.capabilities.add(reservation)
      return reservation
    } finally {this.reserving = false}
  }
  private publishClosed(receipt: Receipt): Promise<void> {
    if (this.publishing) return this.publishing
    const work = this.writeClosed(receipt)
    this.publishing = work
    void work.finally(() => {if (this.publishing === work) this.publishing = undefined}).catch(() => {})
    return work
  }
  private async writeClosed(receipt: Receipt) {
    const temp = `${this.path}.${receipt.claim}.tmp`
    // A stale temporary file is named by this receipt's unguessable claim.
    // Only that owned temp may be replaced after a verified matching DB commit.
    await unlink(temp).catch(error => {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error})
    const file = await open(temp, 'wx', 0o600)
    try {await file.writeFile(JSON.stringify({...receipt, state: 'closed'})); await file.sync()} finally {await file.close()}
    try {await renameReplacing(temp, this.path); await this.syncParent()} catch (error) {await unlink(temp).catch(() => {}); throw error}
  }
  abandon(reservation: SetupReservation) {
    if (this.reservedClaim === reservation.claim) this.reservedClaim = null
    this.capabilities.delete(reservation)
  }
  async complete(reservation: SetupReservation) {
    if (!this.capabilities.has(reservation)) throw this.unavailable()
    const receipt = await this.read()
    if (!receipt || receipt.claim !== reservation.claim || receipt.epoch !== reservation.epoch) throw this.unavailable()
    await this.publishClosed(receipt)
    this.capabilities.delete(reservation)
    this.reservedClaim = null
  }
}
let authority: SetupAuthority | undefined
export function setupAuthority() {
  authority ??= new SetupAuthority(resolve(process.cwd(), 'storage/setup-authority.json'), resolve(process.cwd(), 'storage/backups/.job.lock'))
  return authority
}

/** One transaction, CREATE only, immutable owner/claim; no overwrite branch. */
export async function createSetupOwner(db: Database, passwordHash: string, reservation: SetupReservation): Promise<void> {
  if (!/^[a-f0-9]{48}$/.test(reservation.claim) || !/^[a-f0-9]{48}$/.test(reservation.epoch) || typeof passwordHash !== 'string' || !passwordHash || passwordHash.length > 512) throw createError({statusCode: 400, message: 'Invalid setup credentials'})
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // SDK collect() throws the FIRST cancelled statement and can hide the
    // later business THROW. Inspect every bounded response instead.
    const release = writeBarrier.acquire()
    let execution
    try {execution = db.query(`BEGIN TRANSACTION;
      IF array::len((SELECT id FROM users WHERE username = 'admin' LIMIT 1)) > 0
        OR array::len((SELECT id FROM app_settings WHERE (key = 'setup_completed' AND \`value\` = true)
          OR (key = 'admin_password_hash' AND \`value\` IS NOT NONE AND \`value\` != '') OR key = '__setup_claim' LIMIT 1)) > 0 { THROW 'SETUP_ALREADY_COMPLETED'; };
      CREATE users:admin CONTENT {username: 'admin', password_hash: $passwordHash, auth_epoch: $epoch,
        display_name: 'Administrator', active: true};
      DELETE app_settings WHERE key IN ['admin_username', 'admin_password_hash', 'setup_completed', '__setup_claim'] RETURN NONE;
      CREATE app_settings:admin_username CONTENT {key: 'admin_username', value: 'admin', updated_at: time::now()};
      CREATE app_settings:admin_password_hash CONTENT {key: 'admin_password_hash', value: $passwordHash, updated_at: time::now()};
      CREATE app_settings:setup_completed CONTENT {key: 'setup_completed', value: true, updated_at: time::now()};
      CREATE app_settings:setup_claim CONTENT {key: '__setup_claim', value: $claim, updated_at: time::now()};
      COMMIT TRANSACTION;`, {passwordHash, epoch: reservation.epoch, claim: reservation.claim}).responses().finally(release)} catch (error) {release(); throw error}
    const responses = await Promise.race([execution, new Promise<never>((_resolve, reject) => {timer = setTimeout(() => reject(new Error('Setup response deadline exceeded')), 15_000)})])
    const errors = responses.filter(response => !response.success)
    for (const response of errors) {
      if (!response.success && /SETUP_ALREADY_COMPLETED|already exists|transaction.*conflict/i.test(response.error.message)) throw createError({statusCode: 409, message: 'Admin setup has already been completed'})
    }
    if (errors.length) throw new Error('Setup transaction did not succeed')
  } catch (error) {
    if ((error as {statusCode?: number}).statusCode === 409 || (error instanceof Error && /SETUP_ALREADY_COMPLETED|already exists|transaction.*conflict/i.test(error.message))) throw createError({statusCode: 409, message: 'Admin setup has already been completed'})
    throw createError({statusCode: 503, message: 'Setup commit uncertain; recovery is required'})
  } finally {if (timer) clearTimeout(timer)}
}
