import { useDb } from '../../utils/db'
import { fetchWordRecords } from '../../utils/words'

/** Public batch lookup used when a post payload was rendered without SSR resolution. */
export default defineEventHandler(async (event) => {
  const ids = String(getQuery(event).ids ?? '')
    .split(',')
    .map(id => id.trim())
    .filter(Boolean)

  const db = await useDb()
  const words = await fetchWordRecords(db, ids, { includeArchived: false })
  return { words: [...words.values()] }
})
