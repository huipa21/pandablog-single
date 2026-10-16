import { requireOwner } from '../../../../utils/auth'
import { resetLoggingSettings } from '../../../../utils/logging'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const settings = await resetLoggingSettings()
  return { ok: true, settings }
})
