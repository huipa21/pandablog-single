import { requireOwner } from '../../../../utils/auth'
import { errorGroupListSchema, listErrorGroups } from '../../../../utils/error-groups'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const parsed = errorGroupListSchema.safeParse(getQuery(event))
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Invalid error group query' })
  return listErrorGroups(parsed.data)
})
