import { requireOwner } from '../../../../utils/auth'
import { runLogRetention } from '../../../../utils/log-retention'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  return runLogRetention()
})
