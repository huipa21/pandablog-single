import { requireOwner } from '../../../utils/auth'
import { getAnalyticsOverview, parseAnalyticsRange } from '../../../utils/analytics/read'
import { getAnalyticsSettings } from '../../../utils/settings'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const overview = await getAnalyticsOverview(parseAnalyticsRange(event))
  return { ...overview, analyticsEnabled: getAnalyticsSettings().analytics_enabled }
})
