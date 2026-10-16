import { requireOwner } from '../../../utils/auth'
import { getBackupSettings } from '../../../utils/settings'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const settings = await getBackupSettings()
  return { settings }
})
