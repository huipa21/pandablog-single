import { requireOwner } from '../../utils/auth'
import { queryDb, useDb } from '../../utils/db'
import { mediaInteger, mediaScope } from '../../utils/media-query'
import { firstRow } from '../../utils/surrealResult'
import { mediaListOrphanFiles } from '../../utils/mediaCleanup'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  const query = getQuery(event)
  const olderThanDays = mediaInteger(query.older_than_days, 0, 0, 3650)
  const page = mediaInteger(query.page, 1, 1, 101), limit = mediaInteger(query.limit, 100, 1, 100)
  const db = await useDb()
  const files = await mediaListOrphanFiles(db, olderThanDays, user, page, limit)
  const scope = mediaScope(user), before = olderThanDays ? new Date(Date.now() - olderThanDays * 86_400_000) : null
  const total = firstRow<{total: number}>(await queryDb(db, `SELECT count() AS total FROM files WITH NOINDEX WHERE ${scope.where} AND reference_count = 0 AND referenced_by = [] AND ($before = NULL OR uploaded_at < $before) GROUP ALL TIMEOUT 5s;`, {...scope.params, before}, {retry: 'readOnly', timeoutMs: 6000}))?.total ?? 0
  return {files, total, page, limit, pages: Math.ceil(total / limit)}
})
