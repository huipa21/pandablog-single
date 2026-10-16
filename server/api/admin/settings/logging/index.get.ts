import { requireOwner } from '../../../../utils/auth'
import { getLoggingSettings, initializeLoggingSettings } from '../../../../utils/logging'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  await initializeLoggingSettings()
  return { settings: getLoggingSettings() }
})
