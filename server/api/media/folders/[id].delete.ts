import { requireOwner } from '../../../utils/auth'
import { queryDb, queryDbRecord, useDb } from '../../../utils/db'
import { mediaNormalizeFileRecord, mediaNormalizeFolderId } from '../../../utils/mediaLibrary'
import { firstRow, queryRows } from '../../../utils/surrealResult'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const id = mediaNormalizeFolderId(getRouterParam(event, 'id') ?? '')
  const db = await useDb()

  // Prevent deletion of the Default folder
  const folder = await queryDbRecord(db, 'folder', id)
  if (folder && String(folder.slug ?? '') === 'default') {
    throw createError({ statusCode: 400, message: 'The Default folder cannot be deleted' })
  }

  const filesResponse = await queryDb(db, 'SELECT * FROM files WHERE folders CONTAINS type::record($folder_table, $folder_id);', {
    folder_table: 'folder',
    folder_id: id
  })

  for (const record of queryRows<Record<string, unknown>>(filesResponse)) {
    const file = mediaNormalizeFileRecord(record)
    const nextFolderIds = (file.folders ?? [])
      .map((folder) => mediaNormalizeFolderId(folder))
      .filter((folderId) => folderId !== id)
    await writeFileFolders(db, file.hash, nextFolderIds)
  }

  await queryDb(db, 'UPDATE folder SET parent = NONE WHERE parent = type::record($folder_table, $folder_id);', {
    folder_table: 'folder',
    folder_id: id
  })
  await queryDb(db, 'DELETE FROM type::record($table, $id);', {
    table: 'folder',
    id
  })

  return { success: true }
})

async function writeFileFolders(db: Awaited<ReturnType<typeof useDb>>, hash: string, folderIds: string[]) {
  const params: Record<string, unknown> = {
    table: 'files',
    id: hash,
    folder_table: 'folder'
  }
  const expressions = folderIds.map((folderId, index) => {
    params[`folder_id_${index}`] = folderId
    return `type::record($folder_table, $folder_id_${index})`
  })

  await queryDb(db, `UPDATE type::record($table, $id) SET folders = [${expressions.join(', ')}], updated_at = time::now();`, params)
}
