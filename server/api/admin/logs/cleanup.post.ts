import { z } from 'zod'
import { requireOwner } from '../../../utils/auth'
import { runManualLogCleanup } from '../../../utils/logging'

const cleanupSchema = z.discriminatedUnion('mode', [
  z.object({
    type: z.enum(['activity', 'errors']),
    mode: z.literal('older_than_days'),
    value: z.number().int().min(1).max(3650)
  }),
  z.object({
    type: z.enum(['activity', 'errors']),
    mode: z.literal('keep_latest'),
    value: z.number().int().min(1).max(1_000_000)
  })
])

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const body = await readBody<unknown>(event)
  const parsed = cleanupSchema.safeParse(body)

  if (!parsed.success) {
    throw createError({ statusCode: 400, message: parsed.error.issues[0]?.message ?? 'Invalid cleanup payload' })
  }

  const result = await runManualLogCleanup(parsed.data)
  return { ok: true, result }
})
