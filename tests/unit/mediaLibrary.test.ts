import { beforeEach, describe, expect, it, vi } from 'vitest'
import { queryDb, queryDbRecord } from '../../server/utils/db'
import { mediaDeleteStoredObjects, mediaPublishStagedFile } from '../../server/utils/fileStorage'
import { mediaProcessImageFile } from '../../server/utils/imageProcessor'
import { mediaCleanupOrphanFiles } from '../../server/utils/mediaCleanup'
import { mediaFileQuery } from '../../server/utils/media-query'
import { mediaMetadataTags, mediaMetadataFolders } from '../../server/utils/media-metadata'
import { mediaReserveReferences } from '../../server/utils/referenceTracker'
import { mediaCreateOrReuseFileRecord, mediaNormalizeFileRecord, mediaNormalizeFolderRecord, mediaCleanFolderName, mediaNormalizeHash, mediaNormalizeFolderId, mediaSearchFileRecords } from '../../server/utils/mediaLibrary'
import { mediaRecordManageableByUser, mediaRecordVisibleToUser } from '../../server/utils/mediaPermissions'
import type { MediaSettings } from '../../server/utils/settings'

vi.mock('../../server/utils/db', () => ({findBySlug: vi.fn(), queryDb: vi.fn(), queryDbRecord: vi.fn()}))
vi.mock('../../server/utils/fileStorage', () => ({
  mediaDeleteStoredObjects: vi.fn(), mediaOriginalRelativePath: vi.fn(() => '2026/10/file.txt'),
  mediaStoredFilename: vi.fn((hash: string, ext: string) => `${hash}.${ext}`),
  mediaPublishStagedFile: vi.fn(), mediaFinishPublication: vi.fn()
}))
vi.mock('../../server/utils/imageProcessor', () => ({mediaProcessImageFile: vi.fn()}))
vi.mock('../../server/utils/imageHash', () => ({isSimilar: vi.fn()}))
const hash = 'a'.repeat(64), owner = {id: 'users:admin', username: 'admin'}
const raw = (overrides: Record<string, unknown> = {}) => ({
  id: `files:${hash}`, hash, original_name: 'photo.jpg', stored_name: `${hash}.jpg`, extension: 'jpg',
  mime_type: 'image/jpeg', size: 1024, original_path: `2024/01/${hash}.jpg`, visibility: 'public',
  variants: {thumbnail: {path: `thumbnail/2024/01/${hash}.webp`, mime_type: 'image/webp', width: 360, height: 360, size: 1000}},
  is_image: true, image_meta: {width: 800, height: 600}, folders: [], tags: ['nature', 'nature', 'travel'],
  comment: 'A nice photo', reference_count: 2, referenced_by: [], perceptual_hash: '0'.repeat(64),
  uploaded_at: '2024-01-15T10:00:00.000Z', updated_at: '2024-01-15T11:00:00.000Z', ...overrides
})
beforeEach(() => {vi.clearAllMocks(); vi.mocked(queryDb).mockReset(); vi.mocked(queryDbRecord).mockReset()})
describe('media DTOs and identifiers', () => {
  it('preserves URLs, profiles, metadata and deduplicated tags', () => {
    expect(mediaNormalizeFileRecord(raw())).toMatchObject({hash, width: 800, height: 600, reference_count: 2, tags: ['nature', 'travel'], thumbnail_url: `/media/${hash}?variant=thumbnail`, storage_state: 'ready'})
  })
  it('handles missing fields and nonfinite image dimensions', () => {
    expect(mediaNormalizeFileRecord({id: 'files:minimal', hash: 'minimal'})).toMatchObject({original_name: '', size: 0, is_image: false, width: null, height: null, thumbnail_url: null, visibility: undefined})
    expect(mediaNormalizeFileRecord(raw({image_meta: {width: NaN, height: Infinity}}))).toMatchObject({width: null, height: null})
  })
  it('normalizes folder data and names without permitting empty identifiers', () => {
    expect(mediaNormalizeFolderRecord({id: 'folder:images', name: 'Images', slug: 'images', created_at: new Date('2024-01-01')})).toMatchObject({id: 'folder:images', parent: null})
    expect(mediaCleanFolderName(' Photos ')).toBe('Photos'); expect(mediaCleanFolderName('a'.repeat(200))).toHaveLength(120)
    for (const input of ['', ' ', null]) expect(() => mediaCleanFolderName(input)).toThrow()
    expect(mediaNormalizeFolderId('folder:images')).toBe('images'); expect(() => mediaNormalizeFolderId('')).toThrow()
    expect(mediaNormalizeHash(hash.toUpperCase())).toBe(hash)
    for (const input of ['short', 'z'.repeat(64)]) expect(() => mediaNormalizeHash(input)).toThrow()
  })
  it('fails closed for missing policy or non-ready state and keeps private media owner-only', () => {
    const file = mediaNormalizeFileRecord(raw({visibility: 'private'}))
    expect(mediaRecordVisibleToUser(file, owner)).toBe(true)
    expect(mediaRecordVisibleToUser(file, null)).toBe(false)
    expect(mediaRecordManageableByUser(file, owner)).toBe(true)
    for (const overrides of [{visibility: undefined}, {storage_state: 'publishing'}, {storage_state: 'deleting'}]) expect(mediaRecordVisibleToUser(mediaNormalizeFileRecord(raw(overrides)), owner)).toBe(false)
  })
})
describe('bounded SQL media queries', () => {
  it('projects only the requested page and a scalar count with deterministic tie-breaker', async () => {
    vi.mocked(queryDb).mockResolvedValue([[raw()], [{total: 25}]])
    const result = await mediaSearchFileRecords({} as never, {page: 2, limit: 24, visibleToUser: owner})
    expect(result).toMatchObject({total: 25, pages: 2, page: 2})
    const [_, sql, params] = vi.mocked(queryDb).mock.calls[0]!
    expect(sql).toContain('ORDER BY uploaded_at DESC, id ASC LIMIT $limit START $offset')
    expect(sql).toContain('SELECT count() AS total'); expect(sql).toContain('TIMEOUT 5s')
    expect(sql).toContain("visibility IN ['public', 'private']"); expect(params).toMatchObject({limit: 24, offset: 24})
  })
  it('binds all supported filters before pagination', async () => {
    vi.mocked(queryDbRecord).mockResolvedValue({slug: 'default'})
    const query = await mediaFileQuery({} as never, {file_name: 'REPORT', extension: '.PDF', comment: 'FINAL', tags: ['work', 'review'], folder: 'folder:default', type: 'document', mime_type: 'application/pdf', uploaded_from: '2024-01-01', uploaded_to: '2024-12-31', orphan: true, size_min: 10, size_max: 1000, visibility: 'public', sort: 'name_asc'})
    expect(query.where).toContain('string::contains(string::lowercase(original_name')
    expect(query.where).toContain('array::map(tags'); expect(query.where).toContain('folders = []')
    expect(query.where).toContain('reference_count = 0 AND referenced_by = []')
    expect(query.order).toBe('original_name ASC, id ASC')
    expect(Object.values(query.params)).toEqual(expect.arrayContaining(['report', 'pdf', 'final', 'work', 'review', 10, 1000]))
  })
  it.each(['image', 'video', 'audio', 'document', 'archive', 'other'])('supports %s type and every sort allowlist entry', async type => {
    for (const sort of ['uploaded_at_asc', 'uploaded_at_desc', 'name_asc', 'name_desc', 'size_asc', 'size_desc']) expect((await mediaFileQuery({} as never, {type, sort})).order).toContain('id ASC')
  })
  it.each([{page: Infinity}, {page: NaN}, {page: 0}, {limit: -1}, {limit: 101}, {page: 1001, limit: 100}, {sort: 'size; DELETE files'}, {type: 'bad'}, {uploaded_from: 'invalid'}, {size_min: -1}, {size_min: 50, size_max: 10}, {filename_regex: '(?=lookahead)'}, {tags: Array(21).fill('a')}])('rejects invalid finite/range/pattern options before DB work: %o', async options => {
    await expect(mediaFileQuery({} as never, options)).rejects.toThrow()
    expect(queryDb).not.toHaveBeenCalled()
  })
  it('delegates catastrophic-backtracking-shaped regexes to Rust, never V8 matching', async () => {
    const query = await mediaFileQuery({} as never, {filename_regex: '^(a+)+$'})
    expect(query.where).toContain('string::matches(original_name')
    expect(Object.values(query.params)).toContain('(?i)^(a+)+$')
  })
  it('bounds metadata writer cardinality and keeps canonical deduplication', () => {
    expect(mediaMetadataTags([' Work ', 'Work', 'long'.repeat(30)])).toEqual(['Work', 'long'.repeat(20)])
    expect(mediaMetadataFolders(['folder:images', 'images'])).toEqual(['images'])
    for (const invalid of [null, ['ok', 1], Array(33).fill('tag')]) {
      expect(() => mediaMetadataTags(invalid)).toThrow()
      expect(() => mediaMetadataFolders(invalid)).toThrow()
    }
  })
  it('rejects invalid cleanup selections and [] never means all', async () => {
    expect(await mediaCleanupOrphanFiles({} as never, {hashes: []})).toMatchObject({deleted_count: 0, incomplete: false})
    await expect(mediaCleanupOrphanFiles({} as never, {hashes: ['invalid']})).rejects.toThrow()
    expect(queryDb).not.toHaveBeenCalled()
  })
})
describe('reference source extraction', () => {
  it('ignores ordinary hashes/block IDs/foreign asset filenames but reserves canonical media links', async () => {
    vi.mocked(queryDb).mockResolvedValue([[]])
    await mediaReserveReferences({} as never, 'post:fixture', [{type: 'doc', content: [
      {type: 'text', text: 'b'.repeat(64)},
      {type: 'image', attrs: {blockId: 'c'.repeat(64), src: `https://example.invalid/assets/${'d'.repeat(64)}.png`}},
      {type: 'image', attrs: {src: `/media/${hash}`}},
      {type: 'image', attrs: {src: `%252Fmedia%252F${hash}`}}
    ]}], owner)
    expect(vi.mocked(queryDb).mock.calls).toHaveLength(1)
    expect(vi.mocked(queryDb).mock.calls[0]![2]).toMatchObject({hashes: [hash]})
  })
})
describe('publication ownership and privacy', () => {
  const input = {path: '/owned/file', hash, size: 3, originalName: 'doc.txt', mimeType: 'text/plain', user: owner}
  const settings = {allowed_extensions: ['txt'], max_file_size_mb: 10, enable_perceptual_dedup: false} as MediaSettings
  it('uses NONE fields and obtains CREATE ownership before touching shared paths', async () => {
    vi.mocked(queryDbRecord).mockResolvedValue(null)
    vi.mocked(mediaProcessImageFile).mockResolvedValue({is_image: false, image_meta: null, variants: null, perceptual_hash: null})
    vi.mocked(queryDb).mockResolvedValue([[raw()]])
    await mediaCreateOrReuseFileRecord({} as never, input, settings)
    const create = vi.mocked(queryDb).mock.calls[0]![1]
    expect(create).toContain('image_meta: NONE'); expect(create).toContain('variants: NONE'); expect(create).toContain("storage_state: 'publishing'")
    expect(vi.mocked(queryDb).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(mediaPublishStagedFile).mock.invocationCallOrder[0]!)
  })
  it('losing CREATE never deletes or overwrites winner objects', async () => {
    vi.mocked(queryDbRecord).mockResolvedValue(null)
    vi.mocked(mediaProcessImageFile).mockResolvedValue({is_image: false, image_meta: null, variants: null, perceptual_hash: null})
    vi.mocked(queryDb).mockRejectedValue(new Error('CREATE conflict'))
    await expect(mediaCreateOrReuseFileRecord({} as never, input, settings)).rejects.toThrow(/conflict/)
    expect(mediaDeleteStoredObjects).not.toHaveBeenCalled(); expect(mediaPublishStagedFile).not.toHaveBeenCalled()
  })
  it('dedup does not invent references or reuse a record across visibility', async () => {
    vi.mocked(queryDbRecord).mockResolvedValue(raw())
    expect((await mediaCreateOrReuseFileRecord({} as never, input, settings)).status).toBe('duplicate')
    expect(queryDb).not.toHaveBeenCalled()
    vi.mocked(queryDbRecord).mockResolvedValue(raw({visibility: 'private'}))
    expect(await mediaCreateOrReuseFileRecord({} as never, input, settings)).toMatchObject({status: 'rejected'})
    expect(mediaProcessImageFile).not.toHaveBeenCalled()
  })
})
