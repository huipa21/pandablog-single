import { requireOwner } from '../../../utils/auth'
import { getSiteVisibility } from '../../../utils/visibility'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  return { mode: await getSiteVisibility() }
})
