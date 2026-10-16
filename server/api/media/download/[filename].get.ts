import { requireOwner, getRequestAuthAccount } from '../../../utils/auth'
import { useDb } from '../../../utils/db'
import { authorizedArchiveFiles } from '../../../utils/media-archive-policy'
import { mediaArchiveStore } from '../../../utils/media-archives'
import { privateMediaHeaders } from '../../../utils/media-cache'

export default defineEventHandler(async event => {
  privateMediaHeaders(event)
  const user = await requireOwner(event)
  const account = await getRequestAuthAccount(event, user.id)
  const filename = getRouterParam(event, 'filename') ?? ''
  let meta
  try {meta = await mediaArchiveStore().authorize(filename, user.id, account?.auth_epoch ?? '')}
  catch {throw createError({statusCode: 404, message: 'Download file not found'})}
  await authorizedArchiveFiles(await useDb(), meta.hashes, user, false)
  setResponseHeaders(event, {
    'Content-Type': 'application/zip', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': String(meta.bytes)
  })
  let stream
  try {stream = mediaArchiveStore().stream(filename)} catch {
    setResponseHeader(event, 'Retry-After', 1)
    throw createError({statusCode: 503, message: 'Download capacity exceeded'})
  }
  return sendStream(event, stream)
})
