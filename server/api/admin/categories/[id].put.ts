import { queryDb, queryDbRecord, useDb } from '../../../utils/db'
import { requireOwner } from '../../../utils/auth'
import { firstRow, recordIdPart } from '../../../utils/surrealResult'
import { assertValidCategoryParent, normalizeCategory, taxonomyName, taxonomyParentId, uniqueTaxonomySlug } from '../../../utils/taxonomy'
import { stringOrNull } from '../../../utils/content'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const id = recordIdPart(getRouterParam(event, 'id') ?? '', 'category')
  const body = await readBody<Record<string, unknown>>(event)
  const name = taxonomyName(body.name)
  const db = await useDb()
  const existing = await queryDbRecord(db, 'category', id)
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Category not found' })
  }

  const slug = await uniqueTaxonomySlug(db, 'category', String(body.slug || name), `category:${id}`)
  const description = stringOrNull(body.description)
  const hasParentInput = Object.prototype.hasOwnProperty.call(body, 'parent_id') || Object.prototype.hasOwnProperty.call(body, 'parent')
  const parentId = hasParentInput ? taxonomyParentId(body.parent_id ?? body.parent) : null

  if (slug === 'default' && parentId) {
    throw createError({ statusCode: 400, message: 'Default category cannot be nested' })
  }

  if (slug === 'default') {
    const childResponse = await queryDb(
      db,
      'SELECT id FROM category WHERE parent = type::record($table, $id) LIMIT 1;',
      { table: 'category', id }
    )

    if (firstRow(childResponse)) {
      throw createError({ statusCode: 400, message: 'Default category cannot be a parent' })
    }
  }

  if (hasParentInput) {
    await assertValidCategoryParent(db, id, parentId, slug)
  }

  const assignments: string[] = []
  if (!description) assignments.push('description = NONE')
  if (hasParentInput) {
    assignments.push(parentId ? 'parent = type::record($categoryTable, $parentId)' : 'parent = NONE')
  }
  const clears = assignments.length ? `SET ${assignments.join(', ')}` : ''

  const response = await queryDb(
    db,
    clears
      ? `UPDATE type::record($table, $id) MERGE $category;
         UPDATE type::record($table, $id) ${clears};`
      : 'UPDATE type::record($table, $id) MERGE $category;',
    {
      table: 'category',
      categoryTable: 'category',
      id,
      parentId,
      category: description ? { name, slug, description } : { name, slug }
    }
  )
  const updated = clears
    ? firstRow<Record<string, unknown>>(response, 1) || firstRow<Record<string, unknown>>(response)
    : firstRow<Record<string, unknown>>(response)

  if (!updated) {
    throw createError({ statusCode: 404, message: 'Category not found' })
  }

  return normalizeCategory(updated)
})
