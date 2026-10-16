import { queryDb, useDb } from '../../../utils/db'
import { requireOwner } from '../../../utils/auth'
import { firstRow } from '../../../utils/surrealResult'
import { normalizeTag, taxonomyName, uniqueTaxonomySlug } from '../../../utils/taxonomy'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const body = await readBody<Record<string, unknown>>(event)
  const name = taxonomyName(body.name)
  const db = await useDb()
  const slug = await uniqueTaxonomySlug(db, 'tag', String(body.slug || name))

  const response = await queryDb(
    db,
    'CREATE tag SET name = $name, slug = $slug;',
    { name, slug }
  )
  const created = firstRow<Record<string, unknown>>(response)

  if (!created) {
    throw createError({ statusCode: 500, message: 'Tag was not created' })
  }

  return normalizeTag(created)
})
