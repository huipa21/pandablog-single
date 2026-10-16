import { requireOwner } from '../../../utils/auth'
import { listLogs } from '../../../utils/logging-admin'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  return await listLogs(event, 'activity')
})
