import { requireOwner } from '../../../utils/auth'
import { listThemes, getActiveThemeId } from '../../../utils/theme-loader'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const [themes, activeId] = await Promise.all([listThemes(), getActiveThemeId()])
  return {
    activeId,
    themes
  }
})
