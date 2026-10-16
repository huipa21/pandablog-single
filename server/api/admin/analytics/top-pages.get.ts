import { getQuery } from 'h3'
import { requireOwner } from '../../../utils/auth'
import { getAnalyticsTopPages, parseAnalyticsLimit, parseAnalyticsRange } from '../../../utils/analytics/read'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const query = getQuery(event)
  return await getAnalyticsTopPages(parseAnalyticsRange(event), parseAnalyticsLimit(query.limit, 10, 50))
})
