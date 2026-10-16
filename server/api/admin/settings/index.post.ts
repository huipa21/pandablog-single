import { requireOwner } from '../../../utils/auth'
import { invalidatePublicBootstrapCache } from '../../../utils/publicBootstrap'
import { ADMIN_SETTING_KEYS, filterAdminSettings, readAppSettings, writeAppSettings } from '../../../utils/settings'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const body = await readBody<Record<string, unknown>>(event)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw createError({ statusCode: 400, message: 'Settings payload must be an object' })
  }

  await writeAppSettings(filterAdminSettings(body), ADMIN_SETTING_KEYS)
  invalidatePublicBootstrapCache()
  return { ok: true, settings: await readAppSettings(ADMIN_SETTING_KEYS) }
})
