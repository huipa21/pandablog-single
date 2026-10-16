import { requireOwner, getRequestAuthAccount } from '../../utils/auth'
import { useDb } from '../../utils/db'
import { authorizedArchiveFiles } from '../../utils/media-archive-policy'
import { mediaArchiveStore } from '../../utils/media-archives'
import { privateMediaHeaders } from '../../utils/media-cache'
import { readBoundedJson } from '../../utils/bounded-json'
import { requestAbortSignal } from '../../utils/request-abort'
import { getMediaSettings } from '../../utils/settings'

export default defineEventHandler(async event => {
  privateMediaHeaders(event)
  const user = await requireOwner(event)
  const body = await readBoundedJson(event)
  if (!Array.isArray(body.hashes) || !body.hashes.length || body.hashes.length > 200 || !body.hashes.every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/i.test(hash))) throw createError({statusCode: 400, message: 'Invalid file selection'})
  const hashes = [...new Set((body.hashes as string[]).map(hash => hash.toLowerCase()))]
  // All-or-nothing generic 404: no private filename/existence/path disclosure.
  const files = await authorizedArchiveFiles(await useDb(), hashes, user, true)
  if (hashes.length === 1) return {type: 'single', url: `/media/${hashes[0]}?download=true`}
  const account = await getRequestAuthAccount(event, user.id)
  if (!account?.active) throw createError({statusCode: 401, message: 'Authentication required'})
  const settings = await getMediaSettings()
  const hours = Number.isFinite(settings.download_cleanup_hours) ? Math.min(24, Math.max(1, settings.download_cleanup_hours)) : 1
  let name
  try {
    name = await mediaArchiveStore().create(files.map(file => ({hash: file.hash, original_name: file.original_name, original_path: file.original_path ?? ''})), user.id, account.auth_epoch, {ttlMs: Math.floor(hours * 60 * 60_000), signal: requestAbortSignal(event)})
  } catch {throw createError({statusCode: 503, message: 'Download archive unavailable'})}
  return {type: 'zip', url: `/api/media/download/${name}`}
})
