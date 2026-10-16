import { requireOwner } from '../../../utils/auth'
import { queryDb, useDb } from '../../../utils/db'
import { mediaCleanFolderName, mediaNormalizeFolderId, mediaNormalizeFolderRecord, mediaUniqueFolderSlug } from '../../../utils/mediaLibrary'
import { firstRow } from '../../../utils/surrealResult'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const body = await readBody<Record<string, unknown>>(event)
  const name = mediaCleanFolderName(body.name)
  const db = await useDb()
  const slug = await mediaUniqueFolderSlug(db, String(body.slug || name))
  const params: Record<string, unknown> = { name, slug }
  const parent = typeof body.parent === 'string' && body.parent.trim() ? mediaNormalizeFolderId(body.parent) : ''
  const parentExpression = parent ? 'type::record($parent_table, $parent_id)' : 'NONE'

  if (parent) {
    params.parent_table = 'folder'
    params.parent_id = parent
  }

  const response = await queryDb(
    db,
    `CREATE folder CONTENT {
      name: $name,
      slug: $slug,
      parent: ${parentExpression},
      created_at: time::now(),
      updated_at: time::now()
    };`,
    params
  )
  const folder = firstRow<Record<string, unknown>>(response)

  if (!folder) {
    throw createError({ statusCode: 500, message: 'Folder was not created' })
  }

  return mediaNormalizeFolderRecord(folder)
})
