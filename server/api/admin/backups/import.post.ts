import { randomBytes } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import * as path from 'node:path'
import { requireOwner } from '../../../utils/auth'
import { importExternalBackup } from '../../../utils/backups/importExternal'
import { acquireJob, releaseJob } from '../../../utils/backups/jobMutex'
import { BACKUPS_ROOT } from '../../../utils/backups/config'
import { receiveBackupUpload } from '../../../utils/backups/upload'

export default defineEventHandler(async (event) => {
  await requireOwner(event)
  const owner = await acquireJob({id: `import_${randomBytes(12).toString('hex')}`, kind: 'import', startedAt: new Date().toISOString()})
  const directory = path.join(BACKUPS_ROOT, `.upload-${owner.token}`)
  let created = false
  try {
    await mkdir(directory, {mode: 0o700}); created = true
    const files = await receiveBackupUpload(event.node.req, directory)
    const id = await importExternalBackup(files, owner)
    setResponseStatus(event, 201)
    return {ok: true, id}
  } catch (error) {setResponseHeader(event, 'Connection', 'close'); throw error}
  finally {
    try {if (created) await rm(directory, {recursive: true, force: true, maxRetries: 3, retryDelay: 50})}
    finally {await releaseJob(owner)}
  }
})
