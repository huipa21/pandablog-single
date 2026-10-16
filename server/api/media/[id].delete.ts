import { requireOwner } from '../../utils/auth'
import { useDb } from '../../utils/db'
import { mediaNormalizeHash } from '../../utils/mediaLibrary'
import { mediaDeleteClaimedFile } from '../../utils/mediaCleanup'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  const id = mediaNormalizeHash(getRouterParam(event, 'id') ?? '')
  // Force no longer bypasses live source/version/avatar reservations.
  await mediaDeleteClaimedFile(await useDb(), id, user)
  return {success: true}
})
