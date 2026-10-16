import { queryDb, useDb } from '../../../utils/db'
import { requireOwner } from '../../../utils/auth'
import { normalizeCategory } from '../../../utils/taxonomy'
import { queryRows, stringifyRecordId } from '../../../utils/surrealResult'
import type { CategoryRecord } from '~/types/content'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const db = await useDb()
  const response = await queryDb(
    db,
    `SELECT * FROM category ORDER BY name ASC;
      SELECT out FROM categorized_as;`
  )
  const counts = countMap(queryRows<Record<string, unknown>>(response, 1))
  const categories = queryRows<Record<string, unknown>>(response, 0).map((category) => normalizeCategory({
    ...category,
    post_count: counts.get(stringifyRecordId(category.id)) ?? 0
  }))

  return { categories: categories satisfies CategoryRecord[] }
})

function countMap(rows: Array<Record<string, unknown>>) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const id = stringifyRecordId(row.out)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}
