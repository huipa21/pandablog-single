import { useDb } from '../../../utils/db'
import { requireOwner } from '../../../utils/auth'
import { fetchWordRecords } from '../../../utils/words'

/** Editor-side batch lookup. Archived words are included so existing cards can be repaired. */
export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const ids = String(getQuery(event).ids ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)

  const db = await useDb()
  const words = await fetchWordRecords(db, ids, { includeArchived: true })
  return { words: [...words.values()] }
})
