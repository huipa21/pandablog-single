import { requireOwner } from '../../utils/auth'
import { queryDb, useDb } from '../../utils/db'
import { serializeDate } from '../../utils/content'
import { containsEmoji, slugify } from '../../../utils/slug'
import { mediaScope } from '../../utils/media-query'
import { queryRows } from '../../utils/surrealResult'
import type { MediaTagSummary } from '~/types/content'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event), scope = mediaScope(user)
  const query = getQuery(event), search = typeof query.q === 'string' ? query.q.trim().toLowerCase() : ''
  if (search.length > 80) throw createError({statusCode: 400, message: 'Invalid media tag query'})
  // SPLIT retains a row for tags: []; exclude it before applying string functions.
  const rows = queryRows<{key: string, name: string, count: number, latest: unknown}>(await queryDb(await useDb(), `SELECT key, array::first(array::group(name)) AS name, count() AS count, time::max(uploaded_at) AS latest FROM (SELECT tags AS name, string::lowercase(tags) AS key, uploaded_at FROM (SELECT tags, uploaded_at FROM files WITH NOINDEX WHERE ${scope.where} AND array::len(tags) > 0 SPLIT tags TIMEOUT 5s)) WHERE string::contains(key, $search) GROUP BY key ORDER BY count DESC, key ASC LIMIT 201 TIMEOUT 5s;`, {...scope.params, search}, {retry: 'readOnly', timeoutMs: 6000}))
  const tags: MediaTagSummary[] = rows.slice(0, 200).filter(row => row.name && !containsEmoji(row.name)).map(row => ({id: row.key, name: row.name, slug: slugify(row.name), count: row.count, latest_uploaded_at: serializeDate(row.latest)}))
  return {tags, truncated: rows.length > 200}
})
