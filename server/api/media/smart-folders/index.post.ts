import { requireOwner } from '../../../utils/auth'
import { queryDb, useDb } from '../../../utils/db'
import { firstRow, stringifyRecordId } from '../../../utils/surrealResult'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const body = await readBody<{ name: string; filters: Record<string, unknown> }>(event)

  if (!body.name?.trim()) {
    throw createError({ statusCode: 400, message: 'Name is required' })
  }

  const db = await useDb()
  const response = await queryDb(db, 'CREATE media_smart_folder CONTENT $record;', {
    record: {
      name: body.name.trim().slice(0, 100),
      filters: sanitizeFilters(body.filters)
    }
  })

  const record = firstRow<Record<string, unknown>>(response)
  return {
    id: stringifyRecordId(record?.id),
    name: String(record?.name ?? ''),
    filters: record?.filters ?? {}
  }
})

function sanitizeFilters(filters: unknown): Record<string, unknown> {
  if (!filters || typeof filters !== 'object') return {}
  const f = filters as Record<string, unknown>
  const result: Record<string, unknown> = {}

  if (Array.isArray(f.tags)) {
    result.tags = f.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean).slice(0, 20)
  }
  if (typeof f.filename_regex === 'string' && f.filename_regex.trim()) {
    // Validate regex is safe (limit length, no catastrophic backtracking patterns)
    const regex = f.filename_regex.trim().slice(0, 200)
    try { new RegExp(regex) } catch { return result }
    result.filename_regex = regex
  }
  if (f.filename_regex_case_insensitive === true) {
    result.filename_regex_case_insensitive = true
  }
  if (typeof f.file_type === 'string' && ['image', 'video', 'audio', 'document', 'archive', 'other'].includes(f.file_type)) {
    result.file_type = f.file_type
  }
  if (typeof f.date_from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.date_from)) {
    result.date_from = f.date_from
  }
  if (typeof f.date_to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(f.date_to)) {
    result.date_to = f.date_to
  }
  if (f.orphan_only === true) {
    result.orphan_only = true
  }

  return result
}
