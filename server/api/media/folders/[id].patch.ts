import { requireOwner } from '../../../utils/auth'
import { queryDb, useDb } from '../../../utils/db'
import { mediaCleanFolderName, mediaNormalizeFolderId, mediaNormalizeFolderRecord, mediaUniqueFolderSlug } from '../../../utils/mediaLibrary'
import { firstRow } from '../../../utils/surrealResult'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const id = mediaNormalizeFolderId(getRouterParam(event, 'id') ?? '')
  const body = await readBody<Record<string, unknown>>(event)
  const db = await useDb()
  const assignments = ['updated_at = time::now()']
  const params: Record<string, unknown> = {
    table: 'folder',
    id
  }

  if (Object.prototype.hasOwnProperty.call(body, 'name')) {
    const name = mediaCleanFolderName(body.name)
    params.name = name
    params.slug = await mediaUniqueFolderSlug(db, String(body.slug || name), `folder:${id}`)
    assignments.push('name = $name', 'slug = $slug')
  }

  if (Object.prototype.hasOwnProperty.call(body, 'parent')) {
    const parent = typeof body.parent === 'string' && body.parent.trim() ? mediaNormalizeFolderId(body.parent) : ''

    if (parent === id) {
      throw createError({ statusCode: 400, message: 'A folder cannot be its own parent' })
    }

    if (parent) {
      params.parent_table = 'folder'
      params.parent_id = parent
      assignments.push('parent = type::record($parent_table, $parent_id)')
    } else {
      assignments.push('parent = NONE')
    }
  }

  const response = await queryDb(
    db,
    `UPDATE type::record($table, $id) SET ${assignments.join(', ')} RETURN AFTER;`,
    params
  )
  const folder = firstRow<Record<string, unknown>>(response)

  if (!folder) {
    throw createError({ statusCode: 404, message: 'Folder not found' })
  }

  return mediaNormalizeFolderRecord(folder)
})
