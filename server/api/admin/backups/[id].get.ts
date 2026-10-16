import { requireOwner } from '../../../utils/auth'
import { getBackup } from '../../../utils/backups/registry'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const id = getRouterParam(event, 'id') ?? ''

  const record = await getBackup(id)
  if (!record) {
    throw createError({ statusCode: 404, message: 'Backup snapshot not found' })
  }

  return record
})
