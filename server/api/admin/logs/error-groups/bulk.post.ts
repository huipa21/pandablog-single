import { requireOwner } from '../../../../utils/auth'
import { bulkErrorGroupsSchema, bulkErrorGroups } from '../../../../utils/error-groups'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const parsed = bulkErrorGroupsSchema.safeParse(await readBody(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Invalid bulk error group action' })
  return bulkErrorGroups(parsed.data)
})
