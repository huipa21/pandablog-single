import { createBackupSchema } from '../../../utils/backups/contracts'
import { requireOwner } from '../../../utils/auth'
import { startBackupJob } from '../../../utils/backups/create'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const body = await readBody<unknown>(event)
  const parsed = createBackupSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
  }

  // startBackupJob acquires the mutex, creates the DB record (synchronous portion),
  // fires the heavy work in background, and returns the new id immediately.
  const id = await startBackupJob(parsed.data)

  setResponseStatus(event, 202)
  return { ok: true, id, message: 'Backup started. Poll /api/admin/backups/status for progress.' }
})
