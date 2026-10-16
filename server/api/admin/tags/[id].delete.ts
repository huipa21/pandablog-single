import { queryDb, queryDbRecord, useDb } from '../../../utils/db'
import { requireOwner } from '../../../utils/auth'
import { recordIdPart } from '../../../utils/surrealResult'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const id = recordIdPart(getRouterParam(event, 'id') ?? '', 'tag')
  const db = await useDb()
  const existing = await queryDbRecord(db, 'tag', id)
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Tag not found' })
  }

  await queryDb(
    db,
    `DELETE tagged WHERE out = type::record($table, $id);
     DELETE type::record($table, $id);`,
    { table: 'tag', id }
  )

  return { ok: true }
})
