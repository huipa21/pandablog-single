import { getQuery } from 'h3'
import { requireOwner } from '../../../utils/auth'
import { analyticsGeoDatabaseAvailable } from '../../../utils/analytics/geo'
import { getAnalyticsGeo, parseAnalyticsLimit, parseAnalyticsRange } from '../../../utils/analytics/read'
import { getAnalyticsSettings } from '../../../utils/settings'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const query = getQuery(event)
  const [geo, databaseAvailable] = await Promise.all([
    getAnalyticsGeo(parseAnalyticsRange(event), parseAnalyticsLimit(query.limit, 10, 50)),
    analyticsGeoDatabaseAvailable()
  ])
  return { ...geo, databaseAvailable, analyticsEnabled: getAnalyticsSettings().analytics_enabled }
})
