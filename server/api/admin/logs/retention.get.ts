import { requireOwner } from '../../../utils/auth'
import { getLastRetentionReport, LOG_RETENTION_SCHEDULE } from '../../../utils/log-retention'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  return { last: getLastRetentionReport(), schedule: LOG_RETENTION_SCHEDULE }
})
