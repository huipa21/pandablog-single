import { requireOwner } from '../../../../utils/auth'
import { parseLogType } from '../../../../utils/logging-admin'
import { readLogById } from '../../../../utils/logging'

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const params = getRouterParams(event)
  if (!params.type) {
    throw createError({ statusCode: 400, message: 'Missing log type' })
  }

  const type = parseLogType(params.type)
  const id = params.id

  if (!id) {
    throw createError({ statusCode: 400, message: 'Missing record id' })
  }

  const row = await readLogById(type, id)
  if (!row) {
    throw createError({ statusCode: 404, message: 'Log record not found' })
  }

  return { record: row }
})
