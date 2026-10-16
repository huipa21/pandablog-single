import { queryDb, useDb } from '../../../utils/db'
import { requireOwner } from '../../../utils/auth'
import { firstRow, recordIdPart } from '../../../utils/surrealResult'
import { assertValidCategoryParent, normalizeCategory, taxonomyName, taxonomyParentId, uniqueTaxonomySlug } from '../../../utils/taxonomy'
import { stringOrNull } from '../../../utils/content'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const body = await readBody<Record<string, unknown>>(event)
  const name = taxonomyName(body.name)
  const db = await useDb()
  const slug = await uniqueTaxonomySlug(db, 'category', String(body.slug || name))
  const description = stringOrNull(body.description)
  const parentId = taxonomyParentId(body.parent_id ?? body.parent)

  if (slug === 'default' && parentId) {
    throw createError({ statusCode: 400, message: 'Default category cannot be nested' })
  }

  await assertValidCategoryParent(db, null, parentId, slug)

  const descriptionSql = description ? ', description = $description' : ''
  const parentSql = parentId ? 'type::record($categoryTable, $parentId)' : 'NONE'

  const response = await queryDb(
    db,
    `CREATE category SET name = $name, slug = $slug, parent = ${parentSql}${descriptionSql};`,
    { name, slug, description, categoryTable: 'category', parentId }
  )
  const created = firstRow<Record<string, unknown>>(response)

  if (!created) {
    throw createError({ statusCode: 500, message: 'Category was not created' })
  }

  return normalizeCategory(created)
})
