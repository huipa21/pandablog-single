import { queryDb, useDb } from '../../../utils/db'
import { requireOwner } from '../../../utils/auth'
import { normalizeTag } from '../../../utils/taxonomy'
import { queryRows, stringifyRecordId } from '../../../utils/surrealResult'
import type { TagRecord } from '~/types/content'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const db = await useDb()
  const baseResponse = await queryDb(
    db,
    `SELECT * FROM tag ORDER BY name ASC;
      SELECT out FROM tagged;`
  )
    const postCounts = countByTarget(queryRows<Record<string, unknown>>(baseResponse, 1))

  const tags = queryRows<Record<string, unknown>>(baseResponse, 0).map((tag) => {
    const tagId = stringifyRecordId(tag.id)
    return normalizeTag({
      ...tag,
      post_count: postCounts.get(tagId) ?? 0
    })
  })

  return { tags: tags satisfies TagRecord[] }
})

function countByTarget(rows: Array<Record<string, unknown>>) {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const id = stringifyRecordId(row.out)
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}
