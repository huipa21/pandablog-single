import { requireOwner } from '../../../utils/auth'
import { ADMIN_SETTING_KEYS, readAppSettings } from '../../../utils/settings'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  return { settings: await readAppSettings(ADMIN_SETTING_KEYS) }
})
