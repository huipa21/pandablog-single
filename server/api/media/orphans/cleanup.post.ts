import { requireOwner } from '../../../utils/auth'
import { useDb } from '../../../utils/db'
import { mediaCleanupOrphanFiles } from '../../../utils/mediaCleanup'
import { readBoundedJson } from '../../../utils/bounded-json'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  const body = await readBoundedJson(event, 16 * 1024)
  if (body.hashes !== undefined && (!Array.isArray(body.hashes) || body.hashes.some(hash => typeof hash !== 'string'))) throw createError({statusCode: 400, message: 'Invalid media cleanup selection'})
  const olderThanDays = typeof body.older_than_days === 'number' ? body.older_than_days : undefined
  const db = await useDb()

  const controller = new AbortController()
  const abort = () => {if (!event.node.res.writableEnded) controller.abort()}
  event.node.res.once('close', abort)
  try {
    return await mediaCleanupOrphanFiles(db, {olderThanDays, user, hashes: body.hashes as string[] | undefined, signal: controller.signal})
  } finally {event.node.res.off('close', abort)}
})
