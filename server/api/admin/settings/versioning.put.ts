import { requireOwner } from '../../../utils/auth'
import { updatePostVersioningSettings, type PostVersioningSettings } from '../../../utils/settings'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const body = await readBody<Partial<PostVersioningSettings>>(event)
  const snapshotLimit = Number(body?.snapshot_limit ?? 20)
  const settings: PostVersioningSettings = {
    snapshot_limit: Number.isFinite(snapshotLimit) ? Math.max(1, Math.min(200, Math.floor(snapshotLimit))) : 20
  }
  await updatePostVersioningSettings(settings)
  return { success: true, settings }
})
