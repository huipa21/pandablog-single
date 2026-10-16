import { requireOwner } from '../../../utils/auth'
import { queryDb, useDb } from '../../../utils/db'
import { mediaNormalizeFolderRecord } from '../../../utils/mediaLibrary'
import { queryRows } from '../../../utils/surrealResult'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const db = await useDb()
  const response = await queryDb(db, 'SELECT id, name, slug, parent, created_at, updated_at FROM folder ORDER BY name ASC, id ASC LIMIT 201 TIMEOUT 5s;' )

  return {
    folders: queryRows<Record<string, unknown>>(response).slice(0, 200).map(mediaNormalizeFolderRecord),
    truncated: queryRows(response).length > 200
  }
})
