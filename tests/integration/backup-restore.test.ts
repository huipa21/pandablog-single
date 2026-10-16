import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, access, copyFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { startFixture } from '../../scripts/backend-hardening/fixture'

const faults = vi.hoisted(() => ({refresh: false}))
function mockSettings() {vi.doMock('../../server/utils/settings', async importOriginal => {
  const original = await importOriginal<typeof import('../../server/utils/settings')>()
  return {...original, initializeRuntimeSettings: async (...args: Parameters<typeof original.initializeRuntimeSettings>) => {
    if (faults.refresh) {faults.refresh = false; throw new Error('owned-fixture post-media refresh failure')}
    return original.initializeRuntimeSettings(...args)
  }}
})}

describe.skipIf(process.env.PB_BACKEND_FIXTURE !== '1')('real full restore worker on owned DB/media only', () => {
  it.each(['full', 'empty', 'legacy', 'imported', 'rollback'] as const)('%s backup, streaming restore/rollback, credentials/epochs and historical variants', async kind => {
    vi.doUnmock('../../server/utils/settings'); vi.resetModules(); mockSettings()
    const schema = await readFile(fileURLToPath(new URL('../../server/utils/schema.surql', import.meta.url)), 'utf8')
    const fixture = await startFixture({enabled: process.env.PB_BACKEND_FIXTURE, binary: process.env.PB_BACKEND_SURREAL_BIN ?? ''})
    let dbModule: typeof import('../../server/utils/db') | undefined
    let root: Awaited<ReturnType<NonNullable<typeof dbModule>['connectRootClient']>> | undefined
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(fixture.storage.root)
    try {
      for (const [name, value] of Object.entries({useStorage: () => ({clear: async () => {}}), createError: (options: {message: string}) => Object.assign(new Error(options.message), options)})) vi.stubGlobal(name, value)
      const config = {surrealUrl: `${fixture.endpoint.replace('http:', 'ws:')}/rpc`, surrealRoot: fixture.username, surrealRootPassword: fixture.password, surrealNamespace: fixture.namespace, surrealDatabase: fixture.database, surrealAppUser: 'fixture_app', surrealAppPassword: 'owned-generated-scope-password', public: {}}
      vi.stubGlobal('useRuntimeConfig', () => config)
      // Static schema copy is test source, never configured storage or .env.
      await mkdir(join(fixture.storage.root, 'server/utils'), {recursive: true})
      await writeFile(join(fixture.storage.root, 'server/utils/schema.surql'), schema)
      // Inject an already-quiescent owned worker store. The production new-
      // process hold is independently tested with deterministic clocks; this
      // fixture owns a freshly started DB with no predecessor execution.
      vi.doMock('../../server/utils/backups/jobMutex', async importOriginal => {
        const original = await importOriginal<typeof import('../../server/utils/backups/jobMutex')>()
        const store = new original.JobStore(join(fixture.storage.root, 'storage/backups'))
        return {...original, jobStore: store, acquireJob: store.acquire.bind(store), releaseJob: store.release.bind(store), getActiveJob: store.getActiveJob.bind(store), updateJobProgress: store.progress.bind(store)}
      })
      dbModule = await import('../../server/utils/db')
      const {startBackupJob} = await import('../../server/utils/backups/create')
      const {startRestoreJob} = await import('../../server/utils/backups/restore')
      const {jobStore, getActiveJob} = await import('../../server/utils/backups/jobMutex')
      const {writeBarrier} = await import('../../server/utils/maintenance')
      const {getBackup, pruneBackups} = await import('../../server/utils/backups/registry')
      root = await dbModule.connectRootClient()
      await dbModule.queryDb(root, schema, undefined, {timeoutMs: 30_000})
      await dbModule.provisionAppDatabaseUser(root)
      const epoch = 'a'.repeat(48)
      await dbModule.queryDb(root, `CREATE users:admin CONTENT {username: 'admin', password_hash: 'synthetic', active: true, auth_epoch: $epoch};
        CREATE app_settings:layout CONTENT {key: '__media_storage_version', value: '2026-05-image-variants-v2'};
        CREATE app_settings:backup_options CONTENT {key: 'backups', value: {max_backups: 0, auto_safety_snapshot: true}};
        CREATE fixture_marker:retained SET title = 'base'; CREATE fixture_marker:deleted SET title = 'base';
        DEFINE TABLE access_logs SCHEMALESS;
        CREATE access_logs:cold_history SET request_id = 'historical-request', message = 'snapshot-cold-history';
        CREATE app_settings:legacy_access_marker CONTENT {key: '__access_logs_exported_v1', value: {dir: '/missing-old-mount', total: 17}};`, {epoch})
      const coldMarker = await dbModule.queryDb(root, 'SELECT * FROM app_settings:legacy_access_marker;')
      await mkdir(join(fixture.storage.root, 'storage/logs/access'), {recursive: true})
      const coldFile = join(fixture.storage.root, 'storage/logs/access/.migration-v1.json')
      await writeFile(coldFile, 'unfinished historical receipt; do not repair')
      const image = await sharp({create: {width: 16, height: 16, channels: 3, background: {r: 102, g: 153, b: 170}}}).png().toBuffer()
      const hash = createHash('sha256').update(image).digest('hex'), relative = `2020/01/${hash}.png`
      await mkdir(join(fixture.storage.root, 'storage/uploads/2020/01'), {recursive: true})
      await mkdir(join(fixture.storage.root, 'storage/variants'), {recursive: true})
      if (kind !== 'empty') {
        await writeFile(join(fixture.storage.root, 'storage/uploads', relative), image)
        await dbModule.queryDb(root, `CREATE files:picture CONTENT {hash: $hash, original_name: 'fixture.png', stored_name: $stored, mime_type: 'image/png', size: $size, extension: 'png', original_path: $path, is_image: true, variants: {}};`, {hash, stored: `${hash}.png`, size: image.length, path: relative})
      }
      await writeFile(join(fixture.storage.root, 'storage/variants/sentinel'), 'old-variants')
      await dbModule.queryDb(root, 'DELETE fixture_marker:deleted;')
      const base = await startBackupJob({type: 'full'})
      await vi.waitFor(() => expect(getActiveJob()).toBeNull(), {timeout: 30_000})
      expect((await getBackup(base))?.error).toBeNull()
      expect((await getBackup(base))?.status).toBe('ready')
      let target = base
      const source = join(fixture.storage.root, 'storage/backups', base)
      expect((await getBackup(base))?.bundle_filename).toBe('backup.tar.gz')
      if (kind === 'legacy') {
        const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'))
        delete manifest.format; delete manifest.format_version
        await writeFile(join(source, 'manifest.json'), JSON.stringify(manifest))
        await rm(join(source, 'backup.tar.gz'))
        await dbModule.queryDb(root, 'UPDATE type::record(\'backups\', $id) UNSET format_version, bundle_filename, bundle_size_bytes, bundle_sha256;', {id: base})
        const originalManifest = await readFile(join(source, 'manifest.json'))
        const {ensureBundle} = await import('../../server/utils/backups/package')
        await ensureBundle((await getBackup(base))!)
        expect(await readFile(join(source, 'manifest.json'))).toEqual(originalManifest)
      }
      if (kind === 'imported') {
        const {importExternalBackup} = await import('../../server/utils/backups/importExternal')
        const backupGzPath = fixture.storage.path('external-backup.tar.gz')
        await copyFile(join(source, 'backup.tar.gz'), backupGzPath)
        target = await importExternalBackup({backupGzPath, dbGzPath: '', mediaTarGzPath: ''})
        expect(target).not.toBe(base)
        expect((await getBackup(target))?.bundle_filename).toBe('backup.tar.gz')
      }
      let legacyRow: unknown, numericLegacyRow: unknown
      if (kind === 'full') {
        await dbModule.queryDb(root, "CREATE backups:legacy_evidence CONTENT {type: 'future', status: 'failed', parent: $base, future_selection: {unknown: [42]}};", {base})
        await mkdir(join(fixture.storage.root, 'storage/backups/legacy_evidence'))
        await writeFile(join(fixture.storage.root, 'storage/backups/legacy_evidence/evidence'), 'preserve unknown legacy bytes')
        legacyRow = await dbModule.queryDb(root, 'SELECT * FROM backups:legacy_evidence;')
        await dbModule.queryDb(root, "CREATE type::record('backups', 42) CONTENT {type: 'future', status: 'failed', future_selection: {numeric_id: true}};")
        numericLegacyRow = await dbModule.queryDb(root, "SELECT * FROM type::record('backups', 42);")
        await expect(startRestoreJob('legacy_evidence')).rejects.toMatchObject({statusCode: 409})
        expect(jobStore.getJournal()).toBeNull()
        await expect(startBackupJob({type: 'partial'} as never)).rejects.toMatchObject({statusCode: 400})
      }
      // The artifact holds the OLD DB-user password. The configured runtime
      // secret is rotated before restore and must be reprovisioned/reconnected.
      config.surrealAppPassword = 'owned-current-password-after-snapshot'
      await dbModule.provisionAppDatabaseUser(root)
      await dbModule.recycleRuntimeConnection()
      await dbModule.useDb()
      await dbModule.queryDb(root, "UPDATE fixture_marker:retained SET title = 'live-before-restore'; UPDATE access_logs:cold_history SET message = 'live-cold-history';")
      const oldCacheGeneration = writeBarrier.cacheGeneration()
      faults.refresh = kind === 'rollback' // actual DB + actual FS rollback after media swap
      const token = await startRestoreJob(target)
      expect(jobStore.authorizeStatus(token)).toBe(true)
      await vi.waitFor(() => expect(['committed', 'rolled-back', 'aborted', 'recovery-required']).toContain(jobStore.getJournal()?.state), {timeout: 60_000})
      expect(jobStore.getJournal()?.error).toBe(kind === 'rollback' ? 'owned-fixture post-media refresh failure' : undefined)
      await vi.waitFor(() => expect(getActiveJob()?.kind ?? null).toBeNull(), {timeout: 5_000})
      expect(writeBarrier.status().closed).toBe(false)
      expect(writeBarrier.cacheGeneration()).not.toBe(oldCacheGeneration)
      expect(jobStore.getJournal()?.state).toBe(kind === 'rollback' ? 'rolled-back' : 'committed')
      const rows = (await dbModule.queryDb(root, 'SELECT * FROM fixture_marker:retained;'))[0] as {title: string}[]
      expect(rows[0]?.title).toBe(kind === 'rollback' ? 'live-before-restore' : 'base')
      const coldRows = (await dbModule.queryDb(root, 'SELECT * FROM access_logs:cold_history;'))[0] as {request_id: string, message: string}[]
      expect(coldRows).toHaveLength(1)
      expect(coldRows[0]).toMatchObject({request_id: 'historical-request', message: kind === 'rollback' ? 'live-cold-history' : 'snapshot-cold-history'})
      expect(await dbModule.queryDb(root, 'SELECT * FROM app_settings:legacy_access_marker;')).toEqual(coldMarker)
      expect(await readFile(coldFile, 'utf8')).toBe('unfinished historical receipt; do not repair')
      const account = (await dbModule.queryDb(root, 'SELECT auth_epoch FROM users:admin;'))[0] as {auth_epoch: string}[]
      expect(account[0]?.auth_epoch).not.toBe(epoch)
      const runtime = await dbModule.useDb()
      expect(await dbModule.queryDb(runtime, 'RETURN 1;')).toEqual([1])
      expect((await dbModule.queryDb(root, 'SELECT * FROM fixture_marker:deleted;'))[0]).toEqual([])
      if (kind !== 'empty') expect(await readFile(join(fixture.storage.root, 'storage/uploads', relative))).toEqual(image)
      if (kind === 'rollback') expect(await readFile(join(fixture.storage.root, 'storage/variants/sentinel'), 'utf8')).toBe('old-variants')
      else if (kind !== 'empty') {
        const files = (await dbModule.queryDb(root, 'SELECT variants FROM files:picture;'))[0] as {variants: Record<string, {path: string}>}[]
        expect(files[0]?.variants.thumbnail?.path).toBe(`thumbnail/2020/01/${hash}.webp`)
        await access(join(fixture.storage.root, 'storage/variants', files[0]!.variants.thumbnail!.path))
      }
      const restoredBackup = await getBackup(target)
      expect(restoredBackup?.status).toBe('ready')
      if (kind === 'full') {
        const {importExternalBackup} = await import('../../server/utils/backups/importExternal')
        const dbGzPath = fixture.storage.path('external-db.gz'), mediaTarGzPath = fixture.storage.path('external-media.gz')
        await copyFile(join(source, 'db.surql.gz'), dbGzPath)
        await copyFile(join(source, 'media.tar.gz'), mediaTarGzPath)
        const imported = await importExternalBackup({dbGzPath, mediaTarGzPath, manifestBuffer: await readFile(join(source, 'manifest.json'))})
        expect((await getBackup(imported))?.status).toBe('ready')
        expect(await pruneBackups(1)).toEqual([])
        expect(await getBackup(base)).not.toBeNull(); expect(await getBackup(imported)).not.toBeNull()
        expect(await dbModule.queryDb(root, 'SELECT * FROM backups:legacy_evidence;')).toEqual(legacyRow)
        expect(await dbModule.queryDb(root, "SELECT * FROM type::record('backups', 42);")).toEqual(numericLegacyRow)
        expect(await readFile(join(fixture.storage.root, 'storage/backups/legacy_evidence/evidence'), 'utf8')).toBe('preserve unknown legacy bytes')
      }
      process.stdout.write(JSON.stringify({evidence: 'REV-2.4-actual-worker-owned-DB-FS-not-Nitro-production', kind, state: jobStore.getJournal()?.state, node: process.version, sdk: '2.0.3', surreal: (await root.version()).version}) + '\n')
    } finally {
      faults.refresh = false
      vi.doUnmock('../../server/utils/backups/jobMutex')
      if (dbModule) {await dbModule.closeRootClient(root); await dbModule.shutdownDb()}
      cwd.mockRestore(); vi.unstubAllGlobals(); await fixture.stop()
    }
  }, 120_000)
})
