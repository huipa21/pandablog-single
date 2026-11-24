import { queryDb, useDb } from '../../../utils/db'
import { firstRow, recordIdPart } from '../../../utils/surrealResult'
import { requireOwner } from '../../../utils/auth'
import { normalizeWordRecord } from '../../../utils/words'
import { writeBarrier } from '../../../utils/maintenance'

/** Soft-archive a word. Post cards keep their headword snapshot as fallback. */
export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const id = recordIdPart(getRouterParam(event, 'id') ?? '', 'word')
  if (!id) {
    throw createError({ statusCode: 400, message: 'Word id is required.' })
  }

  const db = await useDb()
  const existingResponse = await queryDb(
    db,
    `SELECT * FROM type::record('word', $id) LIMIT 1;`,
    { id },
    { label: 'load word for archive' }
  )
  if (!firstRow<Record<string, unknown>>(existingResponse)) {
    throw createError({ statusCode: 404, message: 'Word not found.' })
  }

  const response = await queryDb(
    db,
    `UPDATE type::record('word', $id)
     SET archived = true, updated_at = time::now()
     RETURN AFTER;`,
    { id },
    { label: 'archive word' }
  )

  writeBarrier.bumpCacheGeneration()

  const row = firstRow<Record<string, unknown>>(response)
  return { word: row ? normalizeWordRecord(row) : null }
})
