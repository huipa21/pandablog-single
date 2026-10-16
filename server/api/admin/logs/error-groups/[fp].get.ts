import { requireOwner } from '../../../../utils/auth'
import { errorFingerprintSchema, readErrorGroup } from '../../../../utils/error-groups'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const parsed = errorFingerprintSchema.safeParse(getRouterParam(event, 'fp'))
  if (!parsed.success) throw createError({ statusCode: 400, message: 'Invalid error fingerprint' })
  const result = await readErrorGroup(parsed.data)
  if (!result) throw createError({ statusCode: 404, message: 'Error group not found' })
  return result
})
