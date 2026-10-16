import { requireOwner } from '../../../utils/auth'
import { invalidatePublicBootstrapCache } from '../../../utils/publicBootstrap'
import { setActiveThemeId, loadTheme, invalidateThemeCache } from '../../../utils/theme-loader'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const body = await readBody<{ themeId?: string }>(event)
  const themeId = body.themeId?.trim()

  if (!themeId) {
    throw createError({ statusCode: 400, message: 'themeId is required' })
  }

  // Verify the theme exists and loads cleanly before activating
  const theme = await loadTheme(themeId)
  if (!theme) {
    throw createError({ statusCode: 404, message: `Theme "${themeId}" not found or invalid` })
  }

  await setActiveThemeId(themeId)
  invalidateThemeCache()
  invalidatePublicBootstrapCache()

  return { ok: true, activeId: themeId }
})
