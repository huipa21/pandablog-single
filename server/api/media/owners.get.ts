import { requireOwner } from '../../utils/auth'
import { queryDb, useDb } from '../../utils/db'
import { mediaScope } from '../../utils/media-query'
import { queryRows } from '../../utils/surrealResult'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event), scope = mediaScope(user)
  const rows = queryRows<{uploaded_by: string}>(await queryDb(await useDb(), `SELECT uploaded_by FROM files WITH NOINDEX WHERE ${scope.where} AND uploaded_by != NONE GROUP BY uploaded_by ORDER BY uploaded_by LIMIT 201 TIMEOUT 5s;`, scope.params, {retry: 'readOnly', timeoutMs: 6000}))
  return {owners: rows.slice(0, 200).map(row => row.uploaded_by), truncated: rows.length > 200}
})
