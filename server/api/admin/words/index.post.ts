import { queryDb, useDb } from '../../../utils/db'
import { firstRow } from '../../../utils/surrealResult'
import { requireOwner } from '../../../utils/auth'
import { assertUniqueWord, buildWordPayload, normalizeWordRecord } from '../../../utils/words'
import { writeBarrier } from '../../../utils/maintenance'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const body = await readBody<Record<string, unknown>>(event)
  const db = await useDb()
  const payload = buildWordPayload(body)
  await assertUniqueWord(db, payload)

  const response = await queryDb(
    db,
    `CREATE word CONTENT $payload;`,
    { payload: { ...payload, created_at: new Date(), updated_at: new Date() } },
    { label: 'create word' }
  )

  writeBarrier.bumpCacheGeneration()

  const row = firstRow<Record<string, unknown>>(response)
  if (!row) {
    throw createError({ statusCode: 500, message: 'Could not create word.' })
  }

  return { word: normalizeWordRecord(row) }
})
