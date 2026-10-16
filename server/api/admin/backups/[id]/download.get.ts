import { requireOwner } from '../../../../utils/auth'
import { backupIdPart, getBackup } from '../../../../utils/backups/registry'
import { supportedFull } from '../../../../utils/backups/contracts'
import { ensureBundle } from '../../../../utils/backups/package'
import { acquireSnapshotRead } from '../../../../utils/backups/snapshotReads'
import { sendBackupFile, rejectConsolidation } from '../../../../utils/backups/download'
import { BUNDLE_LIMITS } from '../../../../utils/backups/bundle'

export default defineEventHandler(async event => {
  await requireOwner(event)
  rejectConsolidation(event)
  const id = getRouterParam(event, 'id') ?? '', part = backupIdPart(id)
  const release = await acquireSnapshotRead(id)
  try {
    const record = await getBackup(id)
    if (!record || record.status !== 'ready') throw createError({statusCode: 409, message: 'Backup snapshot is missing or not ready'})
    if (!supportedFull(record)) throw createError({statusCode: 409, message: 'Unsupported legacy backup; preserved for offline recovery'})
    const file = await ensureBundle(record)
    return await sendBackupFile(event, file, `pandablog-${part}.tar.gz`, BUNDLE_LIMITS.encodedBytes)
  } finally {release()}
})
