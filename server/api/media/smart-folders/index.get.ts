import { requireOwner } from '../../../utils/auth'
import { queryDb, useDb } from '../../../utils/db'
import { queryRows, stringifyRecordId } from '../../../utils/surrealResult'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const db = await useDb()

  const response = await queryDb(db, 'SELECT * FROM media_smart_folder ORDER BY name ASC;')
  const folders = queryRows<Record<string, unknown>>(response, 0).map((row) => ({
    id: stringifyRecordId(row.id),
    name: String(row.name ?? ''),
    filters: (row.filters as Record<string, unknown>) ?? {},
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? '')
  }))

  return { folders }
})
