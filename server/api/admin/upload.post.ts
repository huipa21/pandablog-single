import { requireOwner } from '../../utils/auth'
import { useDb } from '../../utils/db'
import { mediaCreateOrReuseFileRecord } from '../../utils/mediaLibrary'
import { getMediaSettings } from '../../utils/settings'
import { MEDIA_UPLOAD_LIMITS, receiveMediaUpload } from '../../utils/media-upload'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event), settings = await getMediaSettings(), db = await useDb()
  const controller = new AbortController()
  const abort = () => {if (!event.node.res.writableEnded) controller.abort()}
  event.node.res.once('close', abort)
  let upload
  try {
    upload = await receiveMediaUpload(event.node.req, {files: 1, fileBytes: Math.floor(Math.min(MEDIA_UPLOAD_LIMITS.fileBytes, settings.max_file_size_mb * 1024 * 1024)), signal: controller.signal})
    const result = await mediaCreateOrReuseFileRecord(db, {...upload.files[0]!, user, visibility: upload.visibility, signal: controller.signal}, settings)
    const record = result.record ?? result.similar_to
    if (!record) throw createError({statusCode: 400, message: result.reason || 'Upload failed'})
    return record
  } catch (error) {event.node.res.setHeader('Connection', 'close'); throw error}
  finally {event.node.res.off('close', abort); await upload?.dispose()}
})
