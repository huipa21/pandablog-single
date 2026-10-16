import { readFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Surreal } from 'surrealdb'
import { describe, expect, it, vi } from 'vitest'
import { fixtureRss, startFixture } from '../../scripts/backend-hardening/fixture'
import { mediaSearchFileRecords, mediaFindSimilarImage, mediaCreateOrReuseFileRecord, mediaReadFileByHash, mediaInitializeLegacyState, mediaRecoverInterruptedObjects } from '../../server/utils/mediaLibrary'
import { mediaRemoveAllReferencesForSource, mediaReserveReferences } from '../../server/utils/referenceTracker'
import { mediaClaimDeletion, mediaCleanupOrphanFiles } from '../../server/utils/mediaCleanup'
import { mediaScope } from '../../server/utils/media-query'
import { assertMediaSnapshotReady } from '../../server/utils/media-publication'
import { mediaDashboard } from '../../server/utils/media-dashboard'
import { queryRows } from '../../server/utils/surrealResult'
import type { MediaSettings } from '../../server/utils/settings'
const settings = {allowed_extensions: ['txt'], max_file_size_mb: 10, enable_perceptual_dedup: false} as MediaSettings

// Final objects are redirected into this test's owned memory fixture directory.
// Never use configured app storage, even when exercising the real publisher.
vi.mock('../../server/utils/fileStorage', async importOriginal => {
  const real = await importOriginal<typeof import('../../server/utils/fileStorage')>()
  return {...real,
    mediaPublishStagedFile: async (source: string, relative: string, variant = false) => {
      const {copyFile, constants} = await import('node:fs/promises')
      const destination = join(ownedRoot, variant ? 'variants' : 'originals', relative)
      await mkdir(join(destination, '..'), {recursive: true})
      await copyFile(source, destination, constants.COPYFILE_EXCL)
    },
    mediaFinishPublication: async () => {},
    mediaDeleteStoredObjects: async (file: {original_path?: string, variants?: Record<string, {path: string}>}) => {
      if (file.original_path) await rm(join(ownedRoot, 'originals', file.original_path), {force: true})
      for (const variant of Object.values(file.variants ?? {})) await rm(join(ownedRoot, 'variants', variant.path), {force: true})
    }
  }
})
let ownedRoot = ''
const owner = {id: 'users:admin', username: 'admin'}
const hash = (number: number) => number.toString(16).padStart(64, '0')
describe.skipIf(process.env.PB_BACKEND_FIXTURE !== '1')('Phase 3 actual SDK/3.2.x SQL and owned file publication', () => {
  it('filters/paginates/counts/ranks/regexes before projection; reservations arbitrate deletion', async () => {
    const fixture = await startFixture({enabled: process.env.PB_BACKEND_FIXTURE, binary: process.env.PB_BACKEND_SURREAL_BIN ?? ''}), db = new Surreal()
    ownedRoot = fixture.storage.root
    try {
      await db.connect(`${fixture.endpoint.replace('http:', 'ws:')}/rpc`); await db.signin({username: fixture.username, password: fixture.password}); await db.use({namespace: fixture.namespace, database: fixture.database})
      const schema = await readFile('server/utils/schema.surql', 'utf8')
      const analyzer = schema.split('\n').find(line => line.startsWith('DEFINE ANALYZER') && line.includes('blog_analyzer'))!
      await db.query(analyzer + '\n' + schema.slice(schema.indexOf('DEFINE TABLE OVERWRITE folder'), schema.indexOf('-- ============ MEDIA TAGS')))
      await db.query("CREATE folder:default CONTENT {name: 'Default', slug: 'default'};")
      const rows = [
        {hash: hash(1), name: 'beach-sunset.jpg', visibility: 'public', size: 100, tags: ['nature', 'travel'], comment: 'Final copy'},
        {hash: hash(2), name: 'beech-tree.jpg', visibility: 'public', size: 200, tags: ['nature'], comment: ''},
        {hash: hash(3), name: 'secret.jpg', visibility: 'private', size: 300, tags: ['secret'], comment: ''},
        {hash: hash(4), name: 'owned.jpg', visibility: 'private', size: 400, tags: ['nature'], comment: ''}
      ]
      for (const [index, row] of rows.entries()) await db.query(`CREATE type::record('files', $hash) CONTENT {
        hash: $hash, original_name: $name, stored_name: $name, original_path: $name, mime_type: 'image/jpeg', extension: 'jpg', size: $size,
        visibility: $visibility, tags: $tags, comment: $comment,
        reference_safe: true, perceptual_hash: '0000000000000000000000000000000000000000000000000000000000000000',
        uploaded_at: $date
      };`, {...row, date: new Date(`2024-01-0${index + 1}T00:00:00Z`)})
      const dashboard = await mediaDashboard(db, owner, {range: 'all', start: null, end: new Date()}, 150)
      expect(dashboard.summary).toEqual({total_items: 4, total_storage: 1000, average_size: 250})
      expect(dashboard.orphans.count).toBe(4)
      expect(dashboard.largest_files.map(file => file.hash)).toEqual([hash(4), hash(3), hash(2), hash(1)])
      expect(dashboard.by_type.find(type => type.type === 'other')?.count).toBe(4)
      const page = await mediaSearchFileRecords(db, {visibleToUser: owner, page: 2, limit: 1, sort: 'name_asc'})
      expect(page.total).toBe(4); expect(page.files[0]!.original_name).toBe('beech-tree.jpg')
      expect((await mediaSearchFileRecords(db, {visibleToUser: owner, tags: ['NATURE', 'TRAVEL'], comment: 'final'})).files.map(file => file.hash)).toEqual([hash(1)])
      expect((await mediaSearchFileRecords(db, {visibleToUser: owner, folder: 'default', size_min: 150, size_max: 450})).total).toBe(3)
      expect((await mediaSearchFileRecords(db, {visibleToUser: owner, filename_regex: '^be[ae]ch'})).total).toBe(2)
      expect((await mediaSearchFileRecords(db, {visibleToUser: owner, search: 'baech'})).total).toBe(2)
      expect((await mediaSearchFileRecords(db, {visibleToUser: owner, search: 'beach'})).files.map(file => file.hash)).toEqual([hash(1)])
      await db.query(`CREATE type::record('files', $hash) CONTENT {hash: $hash, original_name: 'etch.jpg', stored_name: 'etch.jpg', original_path: 'etch.jpg', mime_type: 'image/jpeg', extension: 'jpg', size: 1};`, {hash: hash(7)})
      expect((await mediaSearchFileRecords(db, {visibleToUser: owner, search: 'each', sort: 'size_asc'})).files.map(file => file.hash)).toEqual([hash(1), hash(7)])
      await db.query("DELETE type::record('files', $hash);", {hash: hash(7)})
      await db.query(`CREATE type::record('files', $hash) CONTENT {hash: $hash, original_name: $subject, stored_name: 'legacy.txt', original_path: 'legacy.txt', mime_type: 'text/plain', extension: 'txt', size: 10};`, {hash: hash(6), subject: 'a'.repeat(10_000) + '!'})
      const regexStarted = performance.now()
      expect((await mediaSearchFileRecords(db, {visibleToUser: owner, filename_regex: '^(a+)+$'})).total).toBe(0)
      expect(performance.now() - regexStarted).toBeLessThan(1000)
      await db.query("DELETE type::record('files', $hash);", {hash: hash(6)})
      expect((await mediaSearchFileRecords(db, {visibleToUser: owner, uploaded_from: '2024-01-02'})).files.map(file => file.hash)).toEqual([hash(4), hash(3), hash(2)])
      const scope = mediaScope(owner)
      const tags = await db.query(`SELECT key, array::first(array::group(name)) AS name, count() AS count, time::max(uploaded_at) AS latest FROM (SELECT tags AS name, string::lowercase(tags) AS key, uploaded_at FROM (SELECT tags, uploaded_at FROM files WITH NOINDEX WHERE ${scope.where} AND array::len(tags) > 0 SPLIT tags TIMEOUT 5s)) WHERE string::contains(key, $search) GROUP BY key ORDER BY count DESC, key ASC LIMIT 201 TIMEOUT 5s;`, {...scope.params, search: ''})
      expect(queryRows<{name: string}>(tags).some(row => row.name === 'secret')).toBe(true)
      expect(queryRows<{key: string, count: number}>(tags).find(row => row.key === 'nature')?.count).toBe(3)
      const manage = mediaScope(owner, true)
      expect(queryRows(await db.query(`UPDATE type::record('files', $hash) SET comment = 'owner metadata' WHERE ${manage.where} RETURN AFTER;`, {...manage.params, hash: hash(3)}))).toHaveLength(1)
      const updated = await db.query(`UPDATE files SET comment = 'owned metadata' WHERE hash IN $hashes AND ${manage.where} RETURN id;`, {...manage.params, hashes: [hash(1), hash(3), hash(4)]})
      expect(queryRows(updated)).toHaveLength(3)
      const plan = await db.query(`SELECT id, uploaded_at FROM files WITH NOINDEX WHERE ${scope.where} ORDER BY uploaded_at DESC, id ASC LIMIT 24 EXPLAIN FULL;`, scope.params)
      process.stdout.write(JSON.stringify({evidence: 'REV-3-local-query-plan', plan}) + '\n')
      // Only private candidates match a private upload.
      await db.query("UPDATE files SET perceptual_hash = NONE WHERE visibility = 'public';")
      const similar = await mediaFindSimilarImage(db, '0'.repeat(64), 0, owner, 'private')
      expect([hash(3), hash(4)]).toContain(similar?.hash)
      await mediaReserveReferences(db, 'post:fixture', [`/media/${hash(1)}`], owner)
      expect(await mediaClaimDeletion(db, hash(1), owner)).toBeNull()
      await mediaRemoveAllReferencesForSource(db, 'post:fixture')
      const released = await mediaReadFileByHash(db, hash(1))
      expect(released?.reference_count).toBe(0)
      await mediaReserveReferences(db, 'post:fixture', [`/media/${hash(1)}`], owner)
      const deletion = await mediaClaimDeletion(db, hash(2), owner)
      expect(deletion?.claim).toBeTruthy()
      await expect(mediaReserveReferences(db, 'post:loser', [`/media/${hash(2)}`], owner)).rejects.toThrow(/unavailable/)
      expect(await mediaReadFileByHash(db, hash(2))).toBeNull()
      await expect(assertMediaSnapshotReady(db)).rejects.toThrow(/recovery required/)
      // Competing claims/reservations must never both succeed. Conflict errors
      // are confirmed transaction failures, not retried transport ambiguity.
      for (let run = 0; run < 10; run++) {
        await db.query("UPDATE type::record('files', $hash) SET storage_state = 'ready', storage_claim = NONE, referenced_by = [], reference_count = 0;", {hash: hash(4)})
        const [reserved, claimed] = await Promise.allSettled([mediaReserveReferences(db, 'post:race', [`/media/${hash(4)}`], owner), mediaClaimDeletion(db, hash(4), owner)])
        expect(!(reserved.status === 'fulfilled' && claimed.status === 'fulfilled' && claimed.value)).toBe(true)
      }
      expect(await mediaCleanupOrphanFiles(db, {hashes: [], user: owner})).toMatchObject({deleted_count: 0})
      const stage = join(ownedRoot, 'publisher'); await mkdir(stage)
      const data = Buffer.from('ordinary uploaded text'), path = join(stage, 'file')
      await writeFile(path, data)
      const {createHash} = await import('node:crypto'), publicationHash = createHash('sha256').update(data).digest('hex')
      const input = {path, hash: publicationHash, originalName: 'file.txt', mimeType: 'text/plain', size: data.length, user: owner}
      const publications = await Promise.all([mediaCreateOrReuseFileRecord(db, input, settings), mediaCreateOrReuseFileRecord(db, input, settings)])
      expect(publications.map(result => result.status)).toEqual(['created', 'duplicate'])
      expect(publications[0]!.record?.storage_state).toBe('ready')
      expect(await readFile(join(ownedRoot, 'originals', publications[0]!.record!.original_path!))).toEqual(data)
      await db.query(`CREATE type::record('files', $hash) CONTENT {hash: $hash, original_name: 'legacy.txt', stored_name: 'legacy.txt', original_path: 'legacy.txt', mime_type: 'text/plain', extension: 'txt', size: 10};`, {hash: hash(5)})
      await mediaInitializeLegacyState(db); await mediaInitializeLegacyState(db)
      expect((await mediaReadFileByHash(db, hash(5)))?.storage_state).toBe('ready')
      expect(await mediaClaimDeletion(db, hash(5), owner)).toBeNull()
      await mediaRecoverInterruptedObjects(db)
      expect(await mediaReadFileByHash(db, publicationHash)).toBeTruthy()
      // Bounded batches seed a catalog with deliberately heavy metadata that
      // must not appear in a small list DTO. Seed cost is not page latency.
      for (let batch = 0; batch < 20; batch++) {
        const rows = Array.from({length: 50}, (_, index) => ({hash: hash(100 + batch * 50 + index), original_name: `scale-${batch}-${index}.txt`, stored_name: 'scale.txt', original_path: 'scale.txt', mime_type: 'text/plain', extension: 'txt', size: 64, image_meta: {width: 1, height: 1, exif: {heavy: 'x'.repeat(4096)}}, variants: {thumbnail: {path: 'thumbnail/2020/01/scale.webp', extra: 'x'.repeat(4096)}}}))
        await db.query("FOR $row IN $rows { CREATE type::record('files', $row.hash) CONTENT $row RETURN NONE; };", {rows})
      }
      const before = process.memoryUsage(), dbRss = await fixtureRss(fixture.pid), started = performance.now()
      const scaled = await mediaSearchFileRecords(db, {visibleToUser: owner, page: 2, limit: 24, sort: 'name_asc'})
      const elapsedMs = performance.now() - started, encodedBytes = Buffer.byteLength(JSON.stringify(scaled))
      expect(scaled.total).toBeGreaterThanOrEqual(1003); expect(scaled.files).toHaveLength(24)
      expect(encodedBytes).toBeLessThan(64 * 1024)
      expect(JSON.stringify(scaled)).not.toContain('heavy'); expect(JSON.stringify(scaled)).not.toContain('extra')
      process.stdout.write(JSON.stringify({evidence: 'REV-3.2-small-owned-catalog-driver-not-constrained-production', generatedRows: 1000, seedBatchRows: 50, pageRows: scaled.files.length, total: scaled.total, encodedBytes, elapsedMs, before, after: process.memoryUsage(), dbRss}) + '\n')
      process.stdout.write(JSON.stringify({evidence: 'REV-3-local-real-not-production', node: process.version, surreal: (await db.version()).version, sdk: '2.0.3'}) + '\n')
    } finally {await db.close(); await fixture.stop()}
  }, 60_000)
})
