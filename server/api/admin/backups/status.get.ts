import { requireOwner } from '../../../utils/auth'
import { getActiveJob, jobStore } from '../../../utils/backups/jobMutex'
import { writeBarrier } from '../../../utils/maintenance'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const token = getHeader(event, 'X-PandaBlog-Restore-Status') ?? ''
  const capability = jobStore.authorizeStatus(token)
  if (!capability) {
    if (writeBarrier.status().closed) throw createError({statusCode: 403, message: 'Restore status capability required'})
    await requireOwner(event)
  }
  const current = getActiveJob(), journal = jobStore.getJournal()
  const active = capability && current?.token !== journal?.owner.token ? null : current
  // Never serialize owner tokens, artifact paths, hashes or raw recovery errors.
  return {activeJob: active ? {id: active.id, kind: active.kind, startedAt: active.startedAt, progress: active.progress} : null,
    maintenance: writeBarrier.status().closed, recovery_required: jobStore.recoveryRequired() || Boolean(journal?.destructive && writeBarrier.status().recoveryRequired),
    restore_blocked: jobStore.recoveryRequired() || writeBarrier.status().uncertainWrites > 0 || jobStore.maintenanceHoldUntil() > Date.now(),
    jobs_blocked_until: Math.max(jobStore.maintenanceHoldUntil(), writeBarrier.status().uncertainUntil ?? 0) || null,
    restore: journal ? {id: journal.owner.id, phase: journal.phase, state: journal.state, updatedAt: journal.updatedAt} : null}
})
