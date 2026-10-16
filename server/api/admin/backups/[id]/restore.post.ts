import { readBoundedJson } from '../../../../utils/bounded-json'
import { z } from 'zod'
import { requireOwner } from '../../../../utils/auth'
import { startRestoreJob } from '../../../../utils/backups/restore'

const bodySchema = z.object({
  confirm_token: z.string().max(128),
  mode: z.literal('replace'),
})

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const id = getRouterParam(event, 'id') ?? ''
  const body = await readBoundedJson(event, 8 * 1024)
  const parsed = bodySchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
  }

  if (parsed.data.confirm_token !== `RESTORE_${id}`) {
    throw createError({ statusCode: 400, message: 'Invalid confirmation token. Expected RESTORE_<id>.' })
  }

  // startRestoreJob acquires the mutex, marks as restoring, fires background work.
  const statusToken = await startRestoreJob(id)

  setResponseStatus(event, 202)
  return { ok: true, id, status_token: statusToken, message: 'Restore started. Poll /api/admin/backups/status for progress.' }
})
