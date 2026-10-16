import { requireOwner } from '../../../utils/auth'
import { isUserRole, searchUsers, USER_LIST_SORTS, type UserActiveFilter, type UserListSort } from '../../../utils/users'

export default defineEventHandler(async (event) => {
  const actor = await requireOwner(event)
  const query = getQuery(event)
  const limit = normalizeLimit(query.limit)
  const start = normalizeStart(query.start)
  const active = normalizeActiveFilter(query.active)
  const sort = normalizeSort(query.sort)
  const role = isUserRole(query.role) ? query.role : 'all'
  const search = typeof query.q === 'string' ? query.q.trim() : ''
  const { users, total } = await searchUsers({ actor, search, role, active, sort, limit, start })

  return {
    users,
    total,
    limit,
    start
  }
})

function normalizeLimit(value: unknown) {
  const limit = Number(value ?? 10)
  return [10, 20, 30].includes(limit) ? limit : 10
}

function normalizeStart(value: unknown) {
  const start = Number(value ?? 0)
  return Number.isFinite(start) ? Math.max(Math.trunc(start), 0) : 0
}

function normalizeActiveFilter(value: unknown): UserActiveFilter {
  return value === 'enabled' || value === 'disabled' ? value : 'all'
}

function normalizeSort(value: unknown): UserListSort {
  return USER_LIST_SORTS.includes(value as UserListSort) ? value as UserListSort : 'last_login_desc'
}