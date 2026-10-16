import { z } from 'zod'
import { requireOwner } from '../../../utils/auth'
import { listBackups, deleteBackupRecord, deleteSnapshotFiles, backupIdPart } from '../../../utils/backups/registry'
import { acquireJob, releaseJob } from '../../../utils/backups/jobMutex'
import { supportedFull } from '../../../utils/backups/contracts'
import { snapshotHasReaders } from '../../../utils/backups/snapshotReads'
import { readBoundedJson } from '../../../utils/bounded-json'

const schema = z.object({confirm_token: z.string().max(128), cascade: z.literal(false).optional()}).strict()
export default defineEventHandler(async event => {
  await requireOwner(event)
  const id = getRouterParam(event, 'id') ?? '', part = backupIdPart(id)
  const body = schema.safeParse(await readBoundedJson(event, 8 * 1024))
  if (!body.success || body.data.confirm_token !== `DELETE_${id}`) throw createError({statusCode: 400, message: 'Invalid backup deletion confirmation'})
  const owner = await acquireJob({id, kind: 'delete', startedAt: new Date().toISOString()})
  try {
    const records = await listBackups()
    const record = records.find(record => backupIdPart(record.id) === part)
    if (!record) throw createError({statusCode: 404, message: 'Backup snapshot not found'})
    if (!['ready', 'failed'].includes(record.status)) throw createError({statusCode: 409, message: 'Active or publication-ambiguous snapshot is preserved'})
    if (records.some(record => !supportedFull(record))) throw createError({statusCode: 409, message: 'Legacy backup preservation hold; offline retirement requires operator approval'})
    if (snapshotHasReaders(id)) throw createError({statusCode: 409, message: 'Backup download is active; retry after it closes'})
    await deleteSnapshotFiles(id)
    await deleteBackupRecord(id)
    return {ok: true}
  } finally {await releaseJob(owner)}
})
