import { queryDb, useDb } from '../../../utils/db'
import { requireOwner } from '../../../utils/auth'
import { queryRows, recordIdPart, stringifyRecordId } from '../../../utils/surrealResult'

const MAX_IDS = 20

/**
 * Lightweight post lookup by id — used by the editor's post embed NodeViews
 * to live-resolve title, slug, status and cover image. Unlike the full admin
 * post fetch, this returns only the summary fields and no content.
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const rawIds = String(getQuery(event).ids ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)
    .slice(0, MAX_IDS)
  if (!rawIds.length) {
    return { items: [] }
  }

  const db = await useDb()
  const placeholders = rawIds.map((_, index) => `type::record('post', $p${index})`)
  const params: Record<string, unknown> = {}
  rawIds.forEach((id, index) => {
    params[`p${index}`] = recordIdPart(id, 'post')
  })

  const response = await queryDb(
    db,
    `SELECT id, slug, title, status, cover_image FROM post
     WHERE id IN [${placeholders.join(', ')}];`,
    params,
    { label: 'post embed lookup' }
  )

  const items = queryRows<Record<string, unknown>>(response)
    .map((row) => ({
      id: stringifyRecordId(row.id),
      slug: String(row.slug ?? ''),
      title: String(row.title ?? ''),
      status: row.status === 'draft' || row.status === 'archived' ? row.status : 'published',
      cover_image: row.cover_image === undefined || row.cover_image === null ? null : String(row.cover_image)
    }))
    .filter((item) => item.id && item.slug)

  return { items }
})
