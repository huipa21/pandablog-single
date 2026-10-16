import { z } from 'zod'
import { requireOwner } from '../../../utils/auth'
import { getBackupSettings, updateBackupSettings } from '../../../utils/settings'

const bodySchema = z.object({
  max_backups: z.number().int().min(0).max(1000).optional(),
  validate_before_restore: z.boolean().optional(),
  auto_safety_snapshot: z.boolean().optional(),
}).strict()

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const body = await readBody<unknown>(event)
  const parsed = bodySchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message ?? 'Invalid request body' })
  }

  const current = await getBackupSettings()
  const next = { ...current, ...parsed.data }
  await updateBackupSettings(next)

  return { ok: true, settings: next }
})
