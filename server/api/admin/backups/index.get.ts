import { requireOwner } from '../../../utils/auth'
import { listBackups } from '../../../utils/backups/registry'
import { supportedFull } from '../../../utils/backups/contracts'

export default defineEventHandler(async event => {
  await requireOwner(event)
  const snapshots = await listBackups()
  const retentionHeld = snapshots.some(record => !supportedFull(record))
  return snapshots.map(record => ({...record, supported: supportedFull(record), retention_held: retentionHeld}))
})
