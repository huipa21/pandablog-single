import { requireOwner } from '../../../utils/auth'
import { getAnalyticsOverview, parseAnalyticsRange } from '../../../utils/analytics/read'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  return await getAnalyticsOverview(parseAnalyticsRange(event))
})
