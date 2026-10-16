import { requireOwner } from '../../utils/auth'
import { queryDb, queryDbRecord, useDb } from '../../utils/db'
import { mediaNormalizeFileRecord, mediaNormalizeHash } from '../../utils/mediaLibrary'
import { mediaRecordManageableByUser } from '../../utils/mediaPermissions'
import { readBoundedJson } from '../../utils/bounded-json'
import { mediaScope } from '../../utils/media-query'
import { mediaMetadataTags, mediaMetadataFolders } from '../../utils/media-metadata'
import { firstRow } from '../../utils/surrealResult'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  const id = mediaNormalizeHash(getRouterParam(event, 'id') ?? '')
  const body = await readBoundedJson(event, 16 * 1024)
  const db = await useDb()
  const existing = await queryDbRecord(db, 'files', id)
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Media file not found' })
  }
  if (!mediaRecordManageableByUser(mediaNormalizeFileRecord(existing), user)) {
    throw createError({ statusCode: 403, message: 'You can only update media you uploaded' })
  }

  const assignments: string[] = ['updated_at = time::now()']
  const scope = mediaScope(user, true)
  const params: Record<string, unknown> = {
    ...scope.params,
    table: 'files',
    id
  }

  if (Object.prototype.hasOwnProperty.call(body, 'original_name')) {
    const name = typeof body.original_name === 'string' ? body.original_name.trim() : ''
    if (name) {
      params.original_name = name.slice(0, 255)
      assignments.push('original_name = $original_name')
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'comment')) {
    const comment = typeof body.comment === 'string' ? body.comment.trim() : ''
    assignments.push(comment ? 'comment = $comment' : 'comment = NONE')
    if (comment) {
      params.comment = comment.slice(0, 2000)
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'tags')) {
    const tags = mediaMetadataTags(body.tags)
    params.tags = tags
    assignments.push('tags = $tags')
  }

  if (Object.prototype.hasOwnProperty.call(body, 'folders')) {
    const folderIds = mediaMetadataFolders(body.folders)
    const folderExpressions = folderIds.map((folderId, index) => {
      params[`folder_id_${index}`] = folderId
      return `type::record($folder_table, $folder_id_${index})`
    })
    params.folder_table = 'folder'
    assignments.push(`folders = [${folderExpressions.join(', ')}]`)
  }

  if (Object.prototype.hasOwnProperty.call(body, 'visibility')) {
    if (body.visibility !== 'public' && body.visibility !== 'private') throw createError({statusCode: 400, message: 'Invalid media visibility'})
    params.visibility = body.visibility
    assignments.push('visibility = $visibility')
  }

  const response = await queryDb(
    db,
    `UPDATE type::record($table, $id) SET ${assignments.join(', ')} WHERE ${scope.where} RETURN AFTER;`,
    params
  )
  const record = firstRow<Record<string, unknown>>(response)

  if (!record) {
    throw createError({ statusCode: 404, message: 'Media file not found' })
  }

  return mediaNormalizeFileRecord(record)
})
