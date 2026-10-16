import { requireOwner } from '../../../utils/auth'
import { recordActivity } from '../../../utils/activity'
import { setSiteVisibility, type SiteVisibility } from '../../../utils/visibility'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const body = await readBody<{ mode?: SiteVisibility }>(event)
  if (body.mode !== 'public' && body.mode !== 'private') {
    throw createError({ statusCode: 400, message: 'mode must be "public" or "private"' })
  }

  await setSiteVisibility(body.mode)

  recordActivity(event, {
    action: 'site.visibility.update',
    resource_type: 'site',
    resource_id: 'visibility',
    metadata: { mode: body.mode },
    description: `Site visibility changed to ${body.mode}`
  })

  return { ok: true, mode: body.mode }
})
