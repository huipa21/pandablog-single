import { requireOwner } from '../../utils/auth'
import { invalidatePublicBootstrapCache } from '../../utils/publicBootstrap'
import { writeAppSettings } from '../../utils/settings'
import { normalizeThemeMode, PUBLIC_THEME_MODE_KEY } from '~/utils/themeMode'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const body = await readBody<{ mode?: unknown }>(event)
  const mode = normalizeThemeMode(body?.mode)

  if (!mode) {
    throw createError({ statusCode: 400, message: 'mode must be light or dark' })
  }

  await writeAppSettings({ [PUBLIC_THEME_MODE_KEY]: mode }, [PUBLIC_THEME_MODE_KEY])
  invalidatePublicBootstrapCache()

  return { ok: true, mode }
})