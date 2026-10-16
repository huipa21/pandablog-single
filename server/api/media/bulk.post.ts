import { requireOwner } from '../../utils/auth'
import { queryDb, useDb } from '../../utils/db'
import { mediaDeleteClaimedFile } from '../../utils/mediaCleanup'
import { readBoundedJson } from '../../utils/bounded-json'
import { mediaNormalizeHash, mediaNormalizeFolderId, mediaNormalizeFileRecord } from '../../utils/mediaLibrary'
import { mediaRecordManageableByUser } from '../../utils/mediaPermissions'
import { queryRows } from '../../utils/surrealResult'
import { mediaScope } from '../../utils/media-query'
import { mediaMetadataTags, mediaMetadataFolders } from '../../utils/media-metadata'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  const body = await readBoundedJson(event, 32 * 1024) as {
    action: 'delete' | 'update', hashes: string[],
    data?: { tags?: string[]; comment?: string; folders?: string[]; folderMode?: 'replace' | 'add' }
  }

  if (!body.action || !Array.isArray(body.hashes) || !body.hashes.length) {
    throw createError({ statusCode: 400, message: 'action and hashes[] are required' })
  }

  if (body.hashes.length > 200) {
    throw createError({ statusCode: 400, message: 'Maximum 200 files per bulk operation' })
  }

  const db = await useDb()
  const hashes = body.hashes.map((h) => mediaNormalizeHash(h)).filter(Boolean)
  let success = 0
  let failed = 0

  if (body.action === 'delete') {
    for (const hash of hashes) {
      try {await mediaDeleteClaimedFile(db, hash, user); success++} catch {failed++}
    }
  } else if (body.action === 'update') {
    const data = body.data
    if (!data) throw createError({ statusCode: 400, message: 'data is required for update action' })

    const assignments: string[] = ['updated_at = time::now()']
    const scope = mediaScope(user, true)
    const params: Record<string, unknown> = { hashes, ...scope.params }

    if (data.tags !== undefined) {
      params.tags = mediaMetadataTags(data.tags)
      assignments.push('tags = $tags')
    }

    if (data.comment !== undefined) {
      const comment = typeof data.comment === 'string' ? data.comment.trim().slice(0, 2000) : ''
      if (comment) {
        params.comment = comment
        assignments.push('comment = $comment')
      } else {
        assignments.push('comment = NONE')
      }
    }

    if (data.folders !== undefined) {
      const folderIds = mediaMetadataFolders(data.folders)

      if (data.folderMode === 'add' && folderIds.length) {
        const existingResponse = await queryDb(db, `SELECT id, hash, visibility, storage_state, array::slice(folders, 0, 33) AS folders FROM files WHERE hash IN $hashes AND ${scope.where} LIMIT 200;`, {hashes, ...scope.params})
        const filesByHash = new Map(queryRows<Record<string, unknown>>(existingResponse).map((record) => {
          const file = mediaNormalizeFileRecord(record)
          return [file.hash, file]
        }))

        for (const hash of hashes) {
          try {
            const file = filesByHash.get(hash)
            if (!file || !mediaRecordManageableByUser(file, user)) {
              failed++
              continue
            }
            const perFileAssignments = [...assignments]
            const perFileParams: Record<string, unknown> = { ...params, table: 'files', id: hash }
            addFolderAssignment(
              perFileAssignments,
              perFileParams,
              mediaMetadataFolders(Array.from(new Set([...(file.folders?.map((folder) => mediaNormalizeFolderId(folder)) ?? []), ...folderIds])))
            )
            const updated = await queryDb(db, `UPDATE type::record($table, $id) SET ${perFileAssignments.join(', ')} WHERE ${scope.where} RETURN id;`, perFileParams)
            if (queryRows(updated).length) success++; else failed++
          } catch {
            failed++
          }
        }
      } else {
        addFolderAssignment(assignments, params, folderIds)
        try {
          const manageableHashes = await filterManageableHashes(db, hashes, user)
          if (manageableHashes.length) {
            const updated = await queryDb(db, `UPDATE files SET ${assignments.join(', ')} WHERE hash IN $hashes AND ${scope.where} RETURN id;`, { ...params, hashes: manageableHashes })
            success += queryRows(updated).length
          }
          failed += hashes.length - success
        } catch {
          failed += hashes.length
        }
      }
    } else {
      try {
        const manageableHashes = await filterManageableHashes(db, hashes, user)
        if (manageableHashes.length) {
          const updated = await queryDb(db, `UPDATE files SET ${assignments.join(', ')} WHERE hash IN $hashes AND ${scope.where} RETURN id;`, { ...params, hashes: manageableHashes })
          success += queryRows(updated).length
        }
        failed += hashes.length - success
      } catch {
        failed += hashes.length
      }
    }
  } else {
    throw createError({ statusCode: 400, message: 'Invalid action. Use "delete" or "update".' })
  }

  return { success, failed }
})

function addFolderAssignment(assignments: string[], params: Record<string, unknown>, folderIds: string[]) {
  const folderExpressions = folderIds.map((folderId, index) => {
    params[`folder_id_${index}`] = folderId
    return `type::record($folder_table, $folder_id_${index})`
  })
  params.folder_table = 'folder'
  assignments.push(`folders = [${folderExpressions.join(', ')}]`)
}

async function filterManageableHashes(db: Awaited<ReturnType<typeof useDb>>, hashes: string[], user: Awaited<ReturnType<typeof requireOwner>>) {
  if (!hashes.length) {
    return []
  }

  const scope = mediaScope(user, true)
  const response = await queryDb(db, `SELECT hash FROM files WHERE hash IN $hashes AND ${scope.where} LIMIT 200;`, {hashes, ...scope.params})
  const manageable = new Set(queryRows<{hash: string}>(response).map(file => file.hash))

  return hashes.filter((hash) => manageable.has(hash))
}
