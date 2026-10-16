import { requireOwner } from '../../../utils/auth'
import { queryDb, useDb } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const id = (getRouterParam(event, 'id') ?? '').replace(/^media_smart_folder:/, '')
  const db = await useDb()

  await queryDb(db, 'DELETE type::record($table, $id);', {
    table: 'media_smart_folder',
    id
  })

  return { ok: true }
})
