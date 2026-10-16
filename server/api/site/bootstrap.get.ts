import { readPublicBootstrap } from '../../utils/publicBootstrap'
import { isOwner } from '../../utils/auth'
import { getSiteVisibility } from '../../utils/visibility'

export default defineEventHandler(async (event) => {
  const [siteVisibility, authenticated, payload] = await Promise.all([
    getSiteVisibility(),
    isOwner(event),
    readPublicBootstrap()
  ])

  if (siteVisibility === 'private') {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')

    if (!authenticated) {
      return {
        ...payload,
        tags: [],
        categories: []
      }
    }

    return payload
  }

  setResponseHeader(event, 'Cache-Control', 'public, max-age=30, s-maxage=30, stale-while-revalidate=120')
  return payload
})
