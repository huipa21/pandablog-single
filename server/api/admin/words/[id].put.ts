import { queryDb, useDb } from '../../../utils/db'
import { firstRow, recordIdPart } from '../../../utils/surrealResult'
import { requireOwner } from '../../../utils/auth'
import { assertUniqueWord, buildWordPayload, normalizeWordRecord } from '../../../utils/words'
import { writeBarrier } from '../../../utils/maintenance'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const id = recordIdPart(getRouterParam(event, 'id') ?? '', 'word')
  if (!id) {
    throw createError({ statusCode: 400, message: 'Word id is required.' })
  }

  const body = await readBody<Record<string, unknown>>(event)
  const db = await useDb()
  const existingResponse = await queryDb(
    db,
    `SELECT * FROM type::record('word', $id) LIMIT 1;`,
    { id },
    { label: 'load word for update' }
  )
  const existingRow = firstRow<Record<string, unknown>>(existingResponse)
  if (!existingRow) {
    throw createError({ statusCode: 404, message: 'Word not found.' })
  }

  const existing = normalizeWordRecord(existingRow)
  const payload = buildWordPayload(body, existing)
  await assertUniqueWord(db, payload, existing.id)

  const response = await queryDb(
    db,
    `UPDATE type::record('word', $id) MERGE $payload
     RETURN AFTER;`,
    { id, payload: { ...payload, updated_at: new Date() } },
    { label: 'update word' }
  )

  writeBarrier.bumpCacheGeneration()

  const row = firstRow<Record<string, unknown>>(response) ?? {
    ...existingRow,
    ...payload,
    updated_at: new Date()
  }

  return { word: normalizeWordRecord(row) }
})
