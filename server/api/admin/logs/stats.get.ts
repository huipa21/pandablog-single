import { requireOwner } from '../../../utils/auth'
import { gatherLogStats } from '../../../utils/logging'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  return await gatherLogStats()
})
