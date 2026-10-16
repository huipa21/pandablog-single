import * as path from 'node:path'
import { requireOwner } from '../../../../../utils/auth'
import { getBackup, backupIdPart } from '../../../../../utils/backups/registry'
import { BACKUPS_ROOT } from '../../../../../utils/backups/config'
import { supportedFull } from '../../../../../utils/backups/contracts'
import { verifyFullComponents } from '../../../../../utils/backups/snapshot'
import { acquireSnapshotRead } from '../../../../../utils/backups/snapshotReads'
import { sendBackupFile, rejectConsolidation } from '../../../../../utils/backups/download'

export default defineEventHandler(async event => {
  await requireOwner(event)
  rejectConsolidation(event)
  const id = getRouterParam(event, 'id') ?? '', part = backupIdPart(id)
  const release = await acquireSnapshotRead(id)
  try {
    const record = await getBackup(id)
    if (!record || record.status !== 'ready' || !supportedFull(record)) throw createError({statusCode: 409, message: 'A ready standalone full backup is required'})
    const files = await verifyFullComponents(record, path.join(BACKUPS_ROOT, part))
    return await sendBackupFile(event, files.db, `${part}-db.surql.gz`)
  } finally {release()}
})
