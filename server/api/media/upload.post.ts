import { requireOwner } from '../../utils/auth'
import { useDb } from '../../utils/db'
import { mediaCreateOrReuseFileRecord } from '../../utils/mediaLibrary'
import { getMediaSettings } from '../../utils/settings'
import { MEDIA_UPLOAD_LIMITS, receiveMediaUpload } from '../../utils/media-upload'
import type { UploadFileResult } from '~/types/content'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event), settings = await getMediaSettings(), db = await useDb()
  const controller = new AbortController()
  const abort = () => {if (!event.node.res.writableEnded) controller.abort()}
  event.node.res.once('close', abort)
  let upload
  try {
    upload = await receiveMediaUpload(event.node.req, {
      files: Math.floor(Math.min(MEDIA_UPLOAD_LIMITS.files, settings.max_files_per_upload)),
      fileBytes: Math.floor(Math.min(MEDIA_UPLOAD_LIMITS.fileBytes, settings.max_file_size_mb * 1024 * 1024)), signal: controller.signal
    })
    const results: UploadFileResult[] = []
    for (const file of upload.files) {
      if (controller.signal.aborted) throw createError({statusCode: 400, message: 'Media upload aborted'})
      try {
        results.push(await mediaCreateOrReuseFileRecord(db, {...file, user, visibility: upload.visibility, signal: controller.signal}, settings))
      } catch {
        // No storage paths, decoder diagnostics or private dedup metadata.
        results.push({original_name: file.originalName, status: 'rejected', reason: 'Upload failed'})
      }
    }
    return {results}
  } catch (error) {
    // Early 413/408 aborts the entire multipart request, no partial publication.
    event.node.res.setHeader('Connection', 'close')
    throw error
  } finally {event.node.res.off('close', abort); await upload?.dispose()}
})
