import { createError } from 'h3'
import { mkdir, open, rm, rename, lstat } from 'node:fs/promises'
import * as path from 'node:path'
import { BACKUPS_ROOT } from './config'
import { backupIdPart, getBackup, listBackups, replaceBackupRecords, updateBackupRecord, wipeDatabase } from './registry'
import type { BackupRecord } from './config'
import { acquireJob, releaseJob, updateJobProgress, jobStore, syncDirectory, type JobOwner } from './jobMutex'
import { exportSurrealDbToFile, importSurrealDb } from './surrealHttp'
import { validateDumpByStaging, verifySnapshot, type SnapshotProfile } from './validate'
import { collectOriginalPaths, extractMediaTar } from './tarStream'
import { verifyBackupMediaCatalog, assertSameMediaFilesystem } from './media-validation'
import { BACKUP_LIMITS, checkDisk, expandDump, regularFile } from './streams'
import { assertSupportedFull, supportedFull } from './contracts'
import { verifyFullComponents, verifyReadyBundle } from './snapshot'
import { getBackupSettings, getMediaSettings, initializeRuntimeSettings, initializeAnalyticsSettings, initializeSecuritySettings } from '../settings'
import { reloadLoggingSettings } from '../logging'
import { closeRootClient, connectRootClient, provisionAppDatabaseUser, queryDb, recycleRuntimeConnection } from '../db'
import { applySchema } from '../schema'
import { invalidateAnalyticsPublication } from '../analytics/publication'
import { queryRows } from '../surrealResult'
import { mediaProcessImageFile } from '../imageProcessor'
import { newAuthEpoch } from '../users'
import { collapseToSingleOwner } from '../single-owner-migration'
import { writeBarrier } from '../maintenance'

/** Authorization occurs at the API BEFORE issuance of this job-only capability. */
export async function startRestoreJob(id: string): Promise<string> {
  const record = await getBackup(id)
  if (!record || record.status !== 'ready') throw createError({ statusCode: 409, message: 'Backup snapshot is missing or not ready' })
  if (!supportedFull(record)) throw createError({statusCode: 409, message: 'Unsupported legacy backup; preserved for offline recovery'})
  const owner = await acquireJob({id, kind: 'restore', startedAt: new Date().toISOString()})
  let token: string, begun = false
  try {
    token = await jobStore.beginRestore(owner)
    begun = true
    await writeBarrier.close(owner) // synchronous close, then bounded drain
    await writeBarrier.runOwner(owner, () => updateBackupRecord(id, {status: 'restoring'}))
  } catch (error) {
    // Nothing here replaces live DB/media. Failed drain or metadata response
    // is job-only uncertainty, not destructive restore or expert startup recovery.
    if (begun) await jobStore.transition(owner, {state: 'aborted', phase: 'preparing', destructive: false}).catch(() => {})
    if (begun && writeBarrier.status().closed && !writeBarrier.status().recoveryRequired) writeBarrier.abortPreparation(owner)
    await releaseJob(owner).catch(() => {console.warn('[restore] preparation ownership could not be released; jobs remain unavailable')})
    throw error
  }
  void writeBarrier.runOwner(owner, () => runRestoreWork(owner, record)).catch(() => {writeBarrier.recoverFence()})
  return token
}

async function exists(file: string) {try {await lstat(file); return true} catch (error) {if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error}}
async function refreshState() {
  await initializeRuntimeSettings(true)
  await initializeAnalyticsSettings(true)
  await initializeSecuritySettings(true)
  await reloadLoggingSettings()
  await useStorage('cache').clear()
}
async function repairRuntimeAndSessions() {
  const db = await connectRootClient()
  try {
    await applySchema(db, undefined, {preserveData: true})
    await collapseToSingleOwner(db)
    await provisionAppDatabaseUser(db)
    await invalidateAnalyticsPublication(db)
    let after: unknown = null
    while (true) {
      const rows = queryRows<{id: unknown}>(await queryDb(db, 'SELECT id FROM users WHERE $after = NONE OR id > $after ORDER BY id LIMIT 100;', {after}, {retry: 'never'}))
      if (!rows.length) break
      for (const row of rows) await queryDb(db, 'UPDATE $id SET auth_epoch = $epoch;', {id: row.id, epoch: newAuthEpoch()}, {retry: 'never'})
      after = rows[rows.length - 1]!.id
    }
    await queryDb(db, 'DELETE trusted_devices;', undefined, {retry: 'never'})
    const owner = queryRows(await queryDb(db, "SELECT id FROM users:admin WHERE active = true;", undefined, {retry: 'never'}))
    if (owner.length !== 1) throw new Error('Restored owner is unavailable; offline account migration is required')
  } finally {await closeRootClient(db)}
  await recycleRuntimeConnection()
}
async function stageArchives(record: BackupRecord, directory: string, mediaStage: string) {
  const root = path.join(BACKUPS_ROOT, backupIdPart(record.id))
  const files = await verifyFullComponents(record, root)
  if (record.bundle_filename || record.format_version !== undefined) await verifyReadyBundle(record, root)
  const count = await extractMediaTar(files.media, mediaStage)
  const originals = await collectOriginalPaths(mediaStage)
  const hashes = originals.map(rel => path.basename(rel).split('.')[0]!)
  if (count !== record.media_file_count || JSON.stringify([...hashes].sort()) !== JSON.stringify([...record.included_hashes].sort())) throw new Error('Backup media count/catalog mismatch')
  const dump = path.join(directory, 'own.surql')
  await expandDump(files.db, dump)
  return dump
}

/** Cutover is not a DB+FS transaction: each boundary is journaled before work.
 * Safety artifacts persist until BOTH rollback/commit and verification finish. */
export async function runRestoreWork(owner: JobOwner, record: BackupRecord): Promise<void> {
  const directory = path.join(BACKUPS_ROOT, `.restore-${owner.token}`)
  const safetySql = path.join(directory, 'safety.surql'), mediaStage = path.join(directory, 'media-stage')
  const uploads = path.resolve('storage/uploads'), variants = path.resolve('storage/variants')
  const oldUploads = path.join(directory, 'old-uploads'), oldVariants = path.join(directory, 'old-variants')
  let destructive = false, movedUploads = false, movedVariants = false, publishedUploads = false, publishedVariants = false
  let safety: SnapshotProfile | undefined
  let finished = false, ownsStage = false
  let savedBackups: BackupRecord[] = []
  const deadlineAt = Date.now() + 30 * 60_000
  const phase = async (name: string, percent: number, extra: Parameters<typeof jobStore.transition>[1] = {}) => {
    if (name !== 'rollback' && Date.now() > deadlineAt) throw new Error('Restore job deadline exceeded')
    updateJobProgress({phase: name as 'preparing', percent})
    await jobStore.transition(owner, {phase: name, ...extra})
  }
  try {
    assertSupportedFull(record)
    await mkdir(directory, {mode: 0o700}); ownsStage = true
    await mkdir(mediaStage, {mode: 0o700})
    await phase('preparing', 3, {artifacts: {directory, safetySql, oldUploads, oldVariants, mediaStage, uploads, variants}})
    const settings = await getBackupSettings()
    if (!settings.auto_safety_snapshot) throw new Error('Automatic restore requires a verified safety snapshot; offline operator recovery mode is required')
    savedBackups = await listBackups() // never catch to an empty history
    await checkDisk(directory, BACKUP_LIMITS.sqlBytes * 3)
    const dump = await stageArchives(record, directory, mediaStage)
    await phase('db-validate', 18)
    // Always validate; a legacy setting cannot authorize unchecked cutover.
    const expected = await validateDumpByStaging(dump, stage => verifyBackupMediaCatalog(stage, mediaStage))
    // A surviving legacy access table is inert full-snapshot history. Preserve
    // it through the same all-table validation/import/rollback as other tables;
    // there are no access migrations or workers to activate after restoration.
    await phase('safety-snapshot', 26)
    await exportSurrealDbToFile(safetySql)
    await mkdir(uploads, {recursive: true}); await mkdir(variants, {recursive: true})
    await assertSameMediaFilesystem(directory, uploads, variants)
    safety = await validateDumpByStaging(safetySql, stage => verifyBackupMediaCatalog(stage, uploads))
    await collectOriginalPaths(uploads) // refuse unsafe current layout too
    destructive = true // publication failure may already have renamed durable intent
    await phase('db-wipe', 34, {destructive: true})
    await wipeDatabase()
    await phase('db-restore', 42)
    await importSurrealDb(dump)
    await phase('db-verify', 52)
    await verifySnapshot(expected)
    await repairRuntimeAndSessions()
    await replaceBackupRecords(savedBackups)
    await phase('media-restore', 60)
    if (await exists(uploads)) {await rename(uploads, oldUploads); movedUploads = true}
    await rename(mediaStage, uploads); publishedUploads = true
    if (await exists(variants)) {await rename(variants, oldVariants); movedVariants = true}
    await mkdir(variants, {recursive: true}); publishedVariants = true
    // No detached rebuild can outlive maintenance/generation ownership.
    await regenerateVariants(deadlineAt)
    await syncDirectory(path.dirname(uploads)); await syncDirectory(directory)
    await phase('finalize', 92)
    await refreshState()
    await updateBackupRecord(record.id, {status: 'ready', error: null, completed_at: new Date().toISOString()})
    await phase('finalize', 100, {state: 'committed'})
    finished = true
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : 'Restore failed'
    try {
      if (destructive) {
        // Disposing a socket/fetch is NOT proof of execution cancellation. A
        // transport/deadline-ambiguous cutover stays fenced for offline recovery.
        if (jobStore.recoveryRequired() || writeBarrier.status().uncertainWrites || (error as {data?: {uncertain?: boolean}, uncertain?: boolean}).data?.uncertain || (error as {uncertain?: boolean}).uncertain || !safety || writeBarrier.status().active) throw new Error('Cutover execution is uncertain; automatic rollback is unsafe')
        await phase('rollback', 50)
        await wipeDatabase()
        await importSurrealDb(safetySql)
        await verifySnapshot(safety)
        await repairRuntimeAndSessions()
        if (publishedUploads) await rm(uploads, {recursive: true, force: true})
        if (movedUploads) await rename(oldUploads, uploads)
        if (publishedVariants) await rm(variants, {recursive: true, force: true})
        if (movedVariants) await rename(oldVariants, variants)
        await syncDirectory(path.dirname(uploads)); await syncDirectory(directory)
        await replaceBackupRecords(savedBackups)
        await refreshState()
        await updateBackupRecord(record.id, {status: 'ready', error: `${message} — verified rollback completed`})
        await jobStore.transition(owner, {phase: 'rollback', state: 'rolled-back', error: message})
      } else {
        await updateBackupRecord(record.id, {status: 'ready', error: message}).catch(() => {})
        await jobStore.transition(owner, {state: 'aborted', destructive: false, error: message})
      }
      finished = true
    } catch (rollbackError) {
      if (destructive) {
        await jobStore.transition(owner, {state: 'recovery-required', error: `${message}; rollback/recovery: ${String(rollbackError).slice(0, 1000)}`}).catch(() => {})
        writeBarrier.recoverFence()
      } else {
        // Failed pre-destructive journal I/O restricts jobs, not normal traffic.
        writeBarrier.abortPreparation(owner)
        console.warn('[restore] preparation abort could not be recorded; preserve staging and retry initialization normally')
      }
    }
  }
  if (finished) {
    // Journal durability first, fence release second, artifact cleanup last.
    if (destructive) writeBarrier.reopen(owner)
    else writeBarrier.abortPreparation(owner)
    await releaseJob(owner)
    if (ownsStage) await rm(directory, {recursive: true, force: true}).catch(() => {})
  }
}

async function regenerateVariants(deadlineAt: number) {
  let outputBytes = 0
  const db = await connectRootClient()
  try {
    const settings = await getMediaSettings()
    let after: unknown = null
    while (true) {
      const rows = queryRows<{id: unknown, hash: string, original_path: string, mime_type: string}>(await queryDb(db, 'SELECT id, hash, original_path, mime_type FROM files WHERE is_image = true AND ($after = NONE OR id > $after) ORDER BY id LIMIT 50;', {after}, {retry: 'never'}))
      if (!rows.length) break
      for (const file of rows) {
        const original = path.join(path.resolve('storage/uploads'), file.original_path)
        if (Date.now() > deadlineAt) throw new Error('Restore variant deadline exceeded')
        await regularFile(original, 32 * 1024 * 1024)
        await checkDisk(path.dirname(original), 32 * 1024 * 1024)
        const date = new Date(`${file.original_path.slice(0, 4)}-${file.original_path.slice(5, 7)}-01T00:00:00Z`)
        const processed = await mediaProcessImageFile(original, file.hash, file.mime_type, settings.enable_perceptual_dedup, date)
        outputBytes += Object.values(processed.variants ?? {}).reduce((sum, variant) => sum + (variant?.size ?? 0), 0)
        if (outputBytes > BACKUP_LIMITS.mediaBytes) throw new Error('Restored variant disk budget exceeded')
        for (const variant of Object.values(processed.variants ?? {})) {
          if (!variant) continue
          const destination = path.join(path.resolve('storage/variants'), variant.path)
          const output = await open(destination, 'r+')
          try {await output.sync()} finally {await output.close()}
          let parent = path.dirname(destination)
          for (let depth = 0; depth < 4; depth++) {await syncDirectory(parent); parent = path.dirname(parent)}
        }
        await queryDb(db, 'UPDATE $id SET variants = $variants;', {id: file.id, variants: processed.variants}, {retry: 'never'})
      }
      after = rows[rows.length - 1]!.id
    }
  } finally {await closeRootClient(db)}
}
