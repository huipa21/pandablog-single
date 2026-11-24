import { queryDb, useDb } from '../../../utils/db'
import { queryRows } from '../../../utils/surrealResult'
import { requireOwner } from '../../../utils/auth'
import { normalizeWordRecord } from '../../../utils/words'
import { clampFtsNeedle } from '../../../utils/fuzzy'

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500

/**
 * Admin lexicon list. Search covers the headword (FTS plus a literal substring
 * fallback); status filters active vs archived words.
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const query = getQuery(event)
  const q = String(query.q ?? '').trim().slice(0, 200)
  const status = String(query.status ?? 'active')
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(query.limit) || DEFAULT_LIMIT))

  const archivedFilter = status === 'archived'
    ? 'AND archived = true'
    : status === 'all'
      ? ''
      : 'AND archived = false'

  const db = await useDb()
  const params: Record<string, unknown> = {}
  let searchFilter = ''

  if (q) {
    params.needle = clampFtsNeedle(q)
    params.lower = q.toLowerCase()
    searchFilter = 'AND (headword @0@ $needle OR string::lowercase(headword) CONTAINS $lower)'
  }

  const response = await queryDb(
    db,
    `SELECT * FROM word
     WHERE true ${archivedFilter} ${searchFilter}
     ORDER BY archived ASC, headword ASC
     LIMIT ${limit};`,
    params,
    { label: 'admin word list' }
  )

  return {
    words: queryRows<Record<string, unknown>>(response).map(normalizeWordRecord)
  }
})
