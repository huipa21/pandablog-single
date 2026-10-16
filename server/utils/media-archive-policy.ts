import { createError } from 'h3'
import { queryDb, type useDb } from './db'
import { mediaNormalizeFileRecord } from './mediaLibrary'
import { mediaRecordVisibleToUser } from './mediaPermissions'
import { queryRows } from './surrealResult'
import type { SessionUser } from './users'

const sourceSql = 'SELECT id, hash, original_name, original_path, size, visibility, storage_state FROM files WHERE hash IN $hashes LIMIT 200;'
const policySql = 'SELECT id, hash, visibility, storage_state FROM files WHERE hash IN $hashes LIMIT 200;'

export async function authorizedArchiveFiles(db: Awaited<ReturnType<typeof useDb>>, hashes: string[], user: SessionUser, sources: boolean) {
  if (!hashes.length || hashes.length > 200 || new Set(hashes).size !== hashes.length || !hashes.every(hash => /^[a-f0-9]{64}$/.test(hash))) throw createError({statusCode: 400, message: 'Invalid file selection'})
  const rows = queryRows<Record<string, unknown>>(await queryDb(db, sources ? sourceSql : policySql, {hashes}, {retryOnReconnect: false}))
  const files = rows.map(mediaNormalizeFileRecord)
  if (files.length !== hashes.length || new Set(files.map(file => file.hash)).size !== hashes.length || files.some(file => !hashes.includes(file.hash) || !mediaRecordVisibleToUser(file, user))) throw createError({statusCode: 404, message: 'File selection unavailable'})
  return files
}
