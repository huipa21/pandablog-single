import type { MediaRecord } from '~/types/content'
import type { SessionUser } from './users'

export function mediaRecordVisibleToUser(file: MediaRecord, user?: SessionUser | null) {
  if (file.storage_state && file.storage_state !== 'ready') return false
  if (file.visibility === 'public') return true
  return file.visibility === 'private' && Boolean(user)
}

export function mediaRecordManageableByUser(file: MediaRecord, _user: SessionUser) {
  if (file.storage_state && file.storage_state !== 'ready') return false
  return file.visibility === 'private' || file.visibility === 'public'
}