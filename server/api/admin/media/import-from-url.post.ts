import { requireOwner } from '../../../utils/auth'
import { useDb } from '../../../utils/db'
import { mediaCreateOrReuseFileRecord } from '../../../utils/mediaLibrary'
import { getMediaSettings } from '../../../utils/settings'
import { safeOutboundRequest } from '../../../utils/net/outbound'
import { stageMediaBuffer } from '../../../utils/media-upload'
import { readBoundedJson } from '../../../utils/bounded-json'

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
  'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif'
}
export default defineEventHandler(async (event) => {
  const user = await requireOwner(event), body = await readBoundedJson(event, 8 * 1024)
  const rawUrl = typeof body.url === 'string' ? body.url.trim() : ''
  if (!rawUrl || rawUrl.length > 4096) throw createError({statusCode: 400, message: 'Invalid URL'})
  const controller = new AbortController()
  const abort = () => {if (!event.node.res.writableEnded) controller.abort()}
  event.node.res.once('close', abort)
  let stage
  try {
    let downloaded
    try {
      downloaded = await safeOutboundRequest(rawUrl, {
        maxBytes: 10 * 1024 * 1024, maxRedirects: 3, timeoutMs: 15_000,
        headers: {'User-Agent': 'pandablog-image-import/1.0', Accept: 'image/*'}, signal: controller.signal
      })
    } catch {throw createError({statusCode: 400, message: 'Could not fetch URL'})}
    const mimeType = String(downloaded.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
    if (!mimeType.startsWith('image/')) throw createError({statusCode: 400, message: 'URL does not point to an image'})
    if (mimeType === 'image/svg+xml' || mimeType === 'image/svg') throw createError({statusCode: 400, message: 'SVG images cannot be imported'})
    const settings = await getMediaSettings()
    stage = await stageMediaBuffer(downloaded.body, filenameFromUrl(downloaded.url, mimeType), mimeType)
    downloaded.body = Buffer.alloc(0) // Queued work retains only the owned path.
    const result = await mediaCreateOrReuseFileRecord(await useDb(), {...stage.file, user, visibility: 'public', signal: controller.signal}, settings)
    const record = result.record ?? result.similar_to
    if (!record) throw createError({statusCode: 400, message: result.reason || 'Could not import file'})
    return record
  } finally {event.node.res.off('close', abort); await stage?.dispose()}
})
function filenameFromUrl(url: URL, mimeType: string) {
  const segment = url.pathname.split('/').filter(Boolean).pop() ?? ''
  let candidate
  try {candidate = decodeURIComponent(segment)} catch {candidate = segment}
  candidate = (candidate.split('?')[0] ?? '').split('#')[0]?.trim() || 'image'
  const extension = candidate.match(/\.[A-Za-z0-9]{1,5}$/)?.[0]
  if (extension) return candidate.slice(0, -extension.length).slice(0, 240) + extension
  return candidate.slice(0, 240) + (EXT_BY_MIME[mimeType] ? `.${EXT_BY_MIME[mimeType]}` : '')
}
