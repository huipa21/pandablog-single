import type { Surreal } from 'surrealdb'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { createError } from 'h3'
import { mediaDeleteStoredObjects, mediaOriginalRelativePath, mediaStoredFilename, mediaPublishStagedFile, mediaFinishPublication } from './fileStorage'
import { mediaProcessImageFile } from './imageProcessor'
import { isSimilar } from './imageHash'
import { findBySlug, queryDb, queryDbRecord } from './db'
import { slugify, serializeDate } from './content'
import { firstRow, queryRows, recordIdPart, stringifyRecordId } from './surrealResult'
import { getExpectedMimeType, getExtension, validateUpload } from './validateUpload'
import { mediaRecordVisibleToUser } from './mediaPermissions'
import { mediaPublicationAdmission } from './media-publication'
import { mediaFileQuery } from './media-query'
import type { MediaSettings } from './settings'
import type { SessionUser } from './users'
import type { StagedMediaFile } from './media-upload'
import type { MediaFolderRecord, MediaRecord, MediaVariantRecord, MediaVariantSize, UploadFileResult } from '~/types/content'

// Exported separately: unimport's regex export scanner otherwise reads the
// SurrealQL inside this template (string::slice, array::slice, ...) as exports
// named `string`/`array` and injects them into unrelated SSR chunks.
const MEDIA_FILE_RECORD_COLUMNS = `id, hash, string::slice(original_name, 0, 255) AS original_name, extension, mime_type, size, is_image,
  array::slice(folders, 0, 32) AS folders, array::slice(tags, 0, 32) AS tags, string::slice(comment ?? '', 0, 2000) AS comment, reference_count,
  (array::len(folders) > 32 OR array::len(tags) > 32 OR string::len(original_name) > 255 OR string::len(comment ?? '') > 2000) AS metadata_truncated,
  visibility, uploaded_at, updated_at, storage_state,
  image_meta.width AS width, image_meta.height AS height, {format: image_meta.format} AS image_meta,
  {thumbnail: {path: variants.thumbnail.path, mime_type: variants.thumbnail.mime_type, width: variants.thumbnail.width, height: variants.thumbnail.height, size: variants.thumbnail.size},
   medium: {path: variants.medium.path, mime_type: variants.medium.mime_type, width: variants.medium.width, height: variants.medium.height, size: variants.medium.size},
   large: {path: variants.large.path, mime_type: variants.large.mime_type, width: variants.large.width, height: variants.large.height, size: variants.large.size}} AS variants`
export { MEDIA_FILE_RECORD_COLUMNS }
// Reference arrays, pHash, disk ownership/path receipts and arbitrary EXIF/variant
// object properties are not list DTO payloads; the authorized detail route owns them.
export interface MediaCreateUploadInput extends StagedMediaFile {
  visibility?: 'public' | 'private'
  user?: SessionUser
  signal?: AbortSignal
}
export interface MediaSearchOptions {
  page?: number, limit?: number, search?: string, file_name?: string, extension?: string, comment?: string,
  tags?: string[], tag_relation?: 'and' | 'or', filename_regex?: string, filename_regex_case_insensitive?: boolean,
  search_regex?: boolean, case_insensitive?: boolean, sort?: string, type?: string, mime_type?: string,
  folder?: string, tag?: string, uploaded_from?: string, uploaded_to?: string,
  orphan?: boolean, visibility?: string, size_min?: number, size_max?: number, visibleToUser?: SessionUser
}
export function mediaNormalizeFileRecord(record: Record<string, unknown>): MediaRecord {
  const hash = String(record.hash ?? recordIdPart(stringifyRecordId(record.id), 'files'))
  const imageMeta = normalizeObject(record.image_meta), variants = normalizeVariants(record.variants, hash)
  const uploadedAt = serializeDate(record.uploaded_at ?? record.created_at) ?? new Date().toISOString()
  return {
    id: stringifyRecordId(record.id), hash, original_name: String(record.original_name ?? ''),
    stored_name: String(record.stored_name ?? mediaStoredFilename(hash, String(record.extension ?? ''))),
    extension: String(record.extension ?? ''), mime_type: String(record.mime_type ?? ''), size: Number(record.size ?? 0),
    original_path: String(record.original_path ?? ''), url: `/media/${encodeURIComponent(hash)}`, variants,
    thumbnail_url: variants?.thumbnail?.url ?? null,
    width: numberOrNull(imageMeta?.width ?? variants?.large?.width ?? variants?.medium?.width ?? record.width),
    height: numberOrNull(imageMeta?.height ?? variants?.large?.height ?? variants?.medium?.height ?? record.height),
    is_image: Boolean(record.is_image), image_meta: imageMeta, folders: normalizeRecordIdArray(record.folders),
    tags: normalizeStringArray(record.tags), comment: stringOrNull(record.comment), reference_count: Number(record.reference_count ?? 0),
    referenced_by: normalizeRecordIdArray(record.referenced_by),
    visibility: record.visibility === 'private' ? 'private' : record.visibility === 'public' ? 'public' : undefined,
    perceptual_hash: stringOrNull(record.perceptual_hash), created_at: uploadedAt, uploaded_at: uploadedAt,
    updated_at: serializeDate(record.updated_at) ?? uploadedAt,
    metadata_truncated: record.metadata_truncated === true,
    storage_state: record.storage_state === undefined ? 'ready' : typeof record.storage_state === 'string' ? record.storage_state : 'invalid'
  }
}
export function mediaNormalizeFolderRecord(record: Record<string, unknown>): MediaFolderRecord {
  const createdAt = serializeDate(record.created_at) ?? new Date().toISOString()
  return {id: stringifyRecordId(record.id), name: String(record.name ?? ''), slug: String(record.slug ?? ''), parent: record.parent ? stringifyRecordId(record.parent) : null, created_at: createdAt, updated_at: serializeDate(record.updated_at) ?? createdAt}
}

/** Hash ownership is established in DB before any shared final path is written.
 * Failure after ownership leaves a retryable publishing record, never deletes
 * paths on a failed CREATE. Disk and DB are intentionally not called atomic. */
export async function mediaCreateOrReuseFileRecord(db: Surreal, input: MediaCreateUploadInput, settings: MediaSettings): Promise<UploadFileResult> {
  const originalName = input.originalName || 'upload', extension = getExtension(originalName).toLowerCase()
  const mimeType = normalizeUploadMimeType(input.mimeType, extension)
  const validation = validateUpload(originalName, input.size, mimeType, settings)
  if (!validation.valid) return {original_name: originalName, extension, status: 'rejected', reason: validation.reason}
  const hash = mediaNormalizeHash(input.hash), visibility = input.visibility === 'private' ? 'private' : 'public'
  const release = await mediaPublicationAdmission.acquire(input.signal)
  try {
    const raw = await queryDbRecord(db, 'files', hash)
    if (raw) {
      const file = mediaNormalizeFileRecord(raw)
      if (file.storage_state !== 'ready' || !mediaRecordVisibleToUser(file, input.user)
        || file.visibility !== visibility) {
        return {original_name: originalName, extension, status: 'rejected', reason: 'File cannot be reused in this scope'}
      }
      // Uploads are not references. Only actual source reservations increment counts.
      return {original_name: originalName, extension, status: 'duplicate', record: file}
    }
    const createdAt = new Date(), claim = randomUUID(), stage = join(input.path, '..')
    const image = await mediaProcessImageFile(input.path, hash, mimeType, settings.enable_perceptual_dedup, createdAt, stage, input.signal)
    if (image.perceptual_hash && settings.enable_perceptual_dedup) {
      const similar = await mediaFindSimilarImage(db, image.perceptual_hash, settings.perceptual_dedup_threshold, input.user, visibility)
      if (similar) return {original_name: originalName, extension, status: 'similar', similar_to: similar}
    }
    if (input.signal?.aborted) throw new Error('Media publication aborted')
    const originalPath = mediaOriginalRelativePath(hash, extension, createdAt)
    const response = await queryDb(db, `CREATE type::record('files', $hash) CONTENT {
      hash: $hash, original_name: $original_name, stored_name: $stored_name, mime_type: $mime_type,
      size: $size, extension: $extension, uploaded_at: $now, updated_at: $now, comment: NONE,
      is_image: $is_image, image_meta: ${optionalParamExpression(image.image_meta, 'image_meta')},
      folders: [], tags: [], reference_count: 0, referenced_by: [], reference_safe: true, visibility: $visibility,
      original_path: $original_path, variants: ${optionalParamExpression(image.variants, 'variants')},
      perceptual_hash: ${optionalParamExpression(image.perceptual_hash, 'perceptual_hash')},
      storage_state: 'publishing', storage_claim: $claim
    };`, {
      hash, original_name: originalName, stored_name: mediaStoredFilename(hash, extension), mime_type: mimeType,
      size: input.size, extension, now: createdAt, is_image: image.is_image, image_meta: image.image_meta,
      visibility,
      original_path: originalPath, variants: image.variants, perceptual_hash: image.perceptual_hash,
      claim
    }, {retry: 'never'})
    if (!firstRow(response)) throw new Error('File ownership was not established')
    await mediaPublishStagedFile(input.path, originalPath, false, claim)
    for (const [size, variant] of Object.entries(image.variants ?? {})) {
      if (variant) await mediaPublishStagedFile(join(stage, `${size}.webp`), variant.path, true, claim)
    }
    const ready = firstRow<Record<string, unknown>>(await queryDb(db, `UPDATE type::record('files', $hash) SET storage_state = 'ready' WHERE storage_state = 'publishing' AND storage_claim = $claim RETURN AFTER;`, {hash, claim}, {retry: 'never'}))
    if (!ready) throw new Error('Media publication claim lost')
    await mediaFinishPublication({original_path: originalPath, variants: image.variants}, claim)
    await queryDb(db, "UPDATE type::record('files', $hash) SET storage_claim = NONE WHERE storage_state = 'ready' AND storage_claim = $claim RETURN NONE;", {hash, claim}, {retry: 'never'})
    return {original_name: originalName, extension, status: 'created', record: mediaNormalizeFileRecord(ready)}
  } finally {release()}
}
export async function mediaReadFileByHash(db: Surreal, hash: string) {
  const record = await queryDbRecord(db, 'files', recordIdPart(hash, 'files'))
  const file = record ? mediaNormalizeFileRecord(record) : null
  return file?.storage_state === 'ready' ? file : null
}
export async function mediaFindSimilarImage(db: Surreal, perceptualHash: string, threshold: number, user?: SessionUser, visibility?: string) {
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > 64) throw createError({statusCode: 400, message: 'Invalid similarity threshold'})
  const scope = await mediaFileQuery(db, {visibleToUser: user, visibility})
  let after: unknown = null
  // Finite, privacy-filtered candidate budget; no full records until a match.
  for (let page = 0; page < 10; page++) {
    const rows = queryRows<{id: unknown, perceptual_hash: string}>(await queryDb(db, `SELECT id, perceptual_hash FROM files WITH NOINDEX WHERE ${scope.where} AND perceptual_hash != NONE AND ($after = NULL OR id > $after) ORDER BY id LIMIT 100 TIMEOUT 5s;`, {...scope.params, after}, {retry: 'readOnly', timeoutMs: 6000}))
    for (const row of rows) if (isSimilar(perceptualHash, row.perceptual_hash, threshold)) {
      const file = await mediaReadFileByHash(db, recordIdPart(stringifyRecordId(row.id), 'files'))
      if (file && mediaRecordVisibleToUser(file, user) && (!visibility || file.visibility === visibility)) return file
    }
    if (rows.length < 100) break
    after = rows[rows.length - 1]!.id
  }
  return null
}
export async function mediaSearchFileRecords(db: Surreal, options: MediaSearchOptions) {
  const query = await mediaFileQuery(db, options)
  const hint = query.tier ? '' : 'WITH NOINDEX'
  const response = await queryDb(db, `SELECT ${MEDIA_FILE_RECORD_COLUMNS}${query.tier ? `, ${query.tier}` : ''} FROM files ${hint} WHERE ${query.where} ORDER BY ${query.order} LIMIT $limit START $offset TIMEOUT 5s;
    SELECT count() AS total FROM files ${hint} WHERE ${query.where} GROUP ALL TIMEOUT 5s;`, query.params, {retry: 'readOnly', timeoutMs: 11_000})
  const files = queryRows<Record<string, unknown>>(response).map(mediaNormalizeFileRecord).filter(file => mediaRecordVisibleToUser(file, options.visibleToUser))
  if (!Array.isArray(response) || !Array.isArray(response[1])) throw new Error('Media count unavailable')
  const count = firstRow<{total: number}>(response, 1)
  const total = count ? Number(count.total) : 0
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Media count unavailable')
  return {files, total, page: query.page, limit: query.limit, pages: Math.ceil(total / query.limit), search_truncated: query.truncated}
}
export async function mediaUniqueFolderSlug(db: Surreal, desired: string, currentRecordId?: string) {
  const base = slugify(desired)
  for (let suffix = 0; suffix < 100; suffix++) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`, existing = await findBySlug(db, 'folder', candidate)
    if (!existing || (currentRecordId && stringifyRecordId(existing.id) === currentRecordId)) return candidate
  }
  return `${base}-${Date.now()}`
}
export function mediaCleanFolderName(value: unknown) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) throw createError({statusCode: 400, message: 'Folder name is required'})
  return name.slice(0, 120)
}
export function mediaNormalizeHash(value: string) {
  const hash = recordIdPart(value, 'files').trim()
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw createError({statusCode: 400, message: 'Invalid file id'})
  return hash.toLowerCase()
}
export function mediaNormalizeFolderId(value: string) {
  const id = recordIdPart(value, 'folder').trim()
  if (!id || id.length > 120) throw createError({statusCode: 400, message: 'Invalid folder id'})
  return id
}
export async function mediaInitializeLegacyState(db: Surreal) {
  // Additive, conditional pages are themselves the checkpoint. A crash/reentry
  // never overwrites claims, references, ownership, paths or operator settings.
  // Records created before newer SCHEMAFULL fields existed hold NONE there:
  // DEFAULT applies only on CREATE, and UPDATE re-validates every field. Fill
  // only missing values. reference_safe=false is deliberate: legacy reference
  // completeness is never inferred, so such files are not orphan-deletable.
  for (let batch = 0; batch < 100; batch++) {
    const rows = queryRows<{id: unknown}>(await queryDb(db, `SELECT id FROM files WHERE storage_state = NONE OR reference_safe = NONE
      OR reference_count = NONE OR referenced_by = NONE LIMIT 100 TIMEOUT 5s;`, {}, {label: 'media state migration page', retry: 'never'}))
    if (!rows.length) return
    if (rows.length > 100 || rows.some(row => !row.id)) throw new Error('Malformed media state migration page')
    await queryDb(db, `UPDATE files SET storage_state = storage_state ?? 'ready', reference_safe = reference_safe ?? false,
      reference_count = reference_count ?? 0, referenced_by = referenced_by ?? [], is_image = is_image ?? false,
      folders = folders ?? [], tags = tags ?? [], visibility = visibility ?? 'public',
      uploaded_at = uploaded_at ?? time::now(), updated_at = updated_at ?? time::now()
      WHERE id IN $ids AND (storage_state = NONE OR reference_safe = NONE OR reference_count = NONE OR referenced_by = NONE) RETURN NONE;`,
    {ids: rows.map(row => row.id)}, {label: 'media state migration write', retry: 'never'})
  }
  throw new Error('Media state migration checkpoint budget reached; restart to resume')
}
export async function mediaRecoverInterruptedObjects(db: Surreal) {
  // Startup runs before admission, under the single writer receipt. A capped
  // recovery refuses startup if it cannot complete; never hides leftovers.
  for (let page = 0; page < 20; page++) {
    const rows = queryRows<Record<string, unknown>>(await queryDb(db, "SELECT * FROM files WHERE storage_state IN ['publishing', 'deleting'] OR (storage_state = 'ready' AND storage_claim != NONE) LIMIT 50;", {}, {retry: 'never'}))
    if (!rows.length) return
    for (const row of rows) {
      const file = mediaNormalizeFileRecord(row)
      if (typeof row.storage_claim !== 'string') throw new Error('Media recovery requires offline inspection')
      if (file.storage_state === 'ready') {
        await mediaFinishPublication(file, row.storage_claim)
        await queryDb(db, "UPDATE $id SET storage_claim = NONE WHERE storage_state = 'ready' AND storage_claim = $claim RETURN NONE;", {id: row.id, claim: row.storage_claim}, {retry: 'never'})
        continue
      }
      if (file.reference_count || file.referenced_by?.length) throw new Error('Media recovery requires offline inspection')
      if (file.storage_state === 'publishing') await mediaFinishPublication(file, row.storage_claim, true)
      else await mediaDeleteStoredObjects(file)
      await queryDb(db, "DELETE files WHERE id = $id AND storage_claim = $claim AND storage_state IN ['publishing', 'deleting'] RETURN NONE;", {id: row.id, claim: row.storage_claim}, {retry: 'never'})
    }
  }
  throw new Error('Media recovery batch budget exceeded; restart to resume')
}
function optionalParamExpression(value: unknown, name: string) { return value === null || value === undefined || value === '' ? 'NONE' : `$${name}` }
function normalizeUploadMimeType(mimeType: string | undefined, extension: string) { return mimeType && mimeType !== 'application/octet-stream' ? mimeType.trim() : getExpectedMimeType(extension) ?? 'application/octet-stream' }
function normalizeRecordIdArray(value: unknown) { return Array.isArray(value) ? value.map(stringifyRecordId).filter(Boolean) : [] }
function normalizeStringArray(value: unknown) { return Array.isArray(value) ? Array.from(new Set(value.map(entry => String(entry).trim()).filter(Boolean))) : [] }
function normalizeObject(value: unknown) { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
function normalizeVariants(value: unknown, hash: string) {
  const input = normalizeObject(value)
  if (!input) return undefined
  const output: Partial<Record<MediaVariantSize, MediaVariantRecord>> = {}
  for (const size of ['thumbnail', 'medium', 'large'] as MediaVariantSize[]) {
    const raw = normalizeObject(input[size]), path = stringOrNull(raw?.path)
    if (raw && path) output[size] = {path, url: `/media/${encodeURIComponent(hash)}?variant=${size}`, mime_type: stringOrNull(raw.mime_type) ?? 'image/webp', width: numberOrNull(raw.width), height: numberOrNull(raw.height), size: numberOrNull(raw.size)}
  }
  return Object.keys(output).length ? output : undefined
}
function numberOrNull(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : null }
function stringOrNull(value: unknown) { return typeof value === 'string' && value.trim() ? value : null }
