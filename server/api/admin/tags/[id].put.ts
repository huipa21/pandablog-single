import { queryDb, queryDbRecord, useDb } from '../../../utils/db'
import { requireOwner } from '../../../utils/auth'
import { firstRow, recordIdPart } from '../../../utils/surrealResult'
import { normalizeTag, taxonomyName, uniqueTaxonomySlug } from '../../../utils/taxonomy'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const id = recordIdPart(getRouterParam(event, 'id') ?? '', 'tag')
  const body = await readBody<Record<string, unknown>>(event)
  const name = taxonomyName(body.name)
  const db = await useDb()
  const existing = await queryDbRecord(db, 'tag', id)
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Tag not found' })
  }

  const slug = await uniqueTaxonomySlug(db, 'tag', String(body.slug || name), `tag:${id}`)

  const response = await queryDb(
    db,
    'UPDATE type::record($table, $id) MERGE $tag;',
    { table: 'tag', id, tag: { name, slug } }
  )
  const updated = firstRow<Record<string, unknown>>(response)

  if (!updated) {
    throw createError({ statusCode: 404, message: 'Tag not found' })
  }

  return normalizeTag(updated)
})
