import { requireOwner } from '../../../utils/auth'
import { queryDb, useDb } from '../../../utils/db'
import { firstRow, stringifyRecordId } from '../../../utils/surrealResult'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const id = getRouterParam(event, 'id') ?? ''
  const body = await readBody<{ name?: string; filters?: Record<string, unknown> }>(event)
  const db = await useDb()

  const assignments: string[] = ['updated_at = time::now()']
  const params: Record<string, unknown> = { table: 'media_smart_folder', id: normalizeId(id) }

  if (body.name?.trim()) {
    params.name = body.name.trim().slice(0, 100)
    assignments.push('name = $name')
  }

  if (body.filters && typeof body.filters === 'object') {
    params.filters = sanitizeFilters(body.filters)
    assignments.push('filters = $filters')
  }

  const response = await queryDb(
    db,
    `UPDATE type::record($table, $id) SET ${assignments.join(', ')} RETURN AFTER;`,
    params
  )
  const record = firstRow<Record<string, unknown>>(response)

  if (!record) {
    throw createError({ statusCode: 404, message: 'Smart folder not found' })
  }

  return {
    id: stringifyRecordId(record.id),
    name: String(record.name ?? ''),
    filters: record.filters ?? {}
  }
})

function normalizeId(id: string): string {
  // Strip table prefix if present
  return id.replace(/^media_smart_folder:/, '')
}

function sanitizeFilters(filters: unknown): Record<string, unknown> {
  if (!filters || typeof filters !== 'object') return {}
  const f = filters as Record<string, unknown>
  const result: Record<string, unknown> = {}

  if (Array.isArray(f.tags)) {
    result.tags = f.tags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean).slice(0, 20)
  }
  if (typeof f.filename_regex === 'string' && f.filename_regex.trim()) {
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
