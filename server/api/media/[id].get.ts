import { requireOwner } from '../../utils/auth'
import { queryDbRecord, useDb } from '../../utils/db'
import { mediaNormalizeFileRecord, mediaNormalizeHash } from '../../utils/mediaLibrary'
import { mediaRecordVisibleToUser } from '../../utils/mediaPermissions'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  const id = mediaNormalizeHash(getRouterParam(event, 'id') ?? '')
  const db = await useDb()
  const record = await queryDbRecord(db, 'files', id)

  if (!record) {
    throw createError({ statusCode: 404, message: 'Media file not found' })
  }

  const file = mediaNormalizeFileRecord(record)
  if (!mediaRecordVisibleToUser(file, user)) {
    throw createError({ statusCode: 404, message: 'Media file not found' })
  }

  return file
})
