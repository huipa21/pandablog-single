import { requireOwner } from '../../../utils/auth'
import { parseLogType } from '../../../utils/logging-admin'
import { purgeLogType } from '../../../utils/logging'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  // H3 can select this DELETE handler through a static GET route without
  // retaining params. Keep retired access in parsing only to reject it safely.
  const type = getRouterParams(event).type
    ?? /^\/api\/admin\/logs\/(access|activity|errors)\/?$/.exec(getRequestURL(event).pathname)?.[1]
  if (!type) {
    throw createError({ statusCode: 400, message: 'Missing log type' })
  }

  const safeType = parseLogType(type)
  const body = await readBody<{ confirm_token?: string }>(event)

  if (body.confirm_token !== `PURGE_${safeType.toUpperCase()}`) {
    throw createError({ statusCode: 400, message: 'Invalid confirmation token' })
  }

  const deleted = await purgeLogType(safeType)
  return { ok: true, deleted }
})
