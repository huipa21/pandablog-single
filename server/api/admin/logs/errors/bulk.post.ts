import { z } from 'zod'
import { requireOwner } from '../../../../utils/auth'
import { deleteErrorLogsByIds, setErrorLogsReadState } from '../../../../utils/logging'

const bulkErrorLogsSchema = z.object({
  action: z.enum(['mark_read', 'mark_unread', 'delete']),
  ids: z.array(z.string().min(1)).min(1).max(200)
}).strict()

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const parsed = bulkErrorLogsSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: 'Invalid bulk error log action' })
  }

  const { action, ids } = parsed.data

  if (action === 'delete') {
    const deletedIds = await deleteErrorLogsByIds(ids)
    return { ok: true, action, deleted: deletedIds.length, deleted_ids: deletedIds }
  }

  const updatedIds = await setErrorLogsReadState(ids, action === 'mark_read')
  return { ok: true, action, updated: updatedIds.length, updated_ids: updatedIds }
})