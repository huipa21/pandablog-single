import { requireOwner } from '../../../utils/auth'
import { assertCanCreateUserRole, assertCanManageTargetUser, assertNotSelf } from '../../../utils/user-management'
import { findUserById, isUserRole, updateUser, type UserRole } from '../../../utils/users'

type BulkUserAction = 'enable' | 'disable' | 'role'

interface BulkUsersBody {
  ids?: string[]
  action?: BulkUserAction
  role?: UserRole
}

export default defineEventHandler(async (event) => {
  const actor = await requireOwner(event)
  const body = await readBody<BulkUsersBody>(event)
  const rawIds = Array.isArray(body?.ids) ? body.ids : []
  const ids = Array.from(new Set(rawIds.map((id) => String(id || '').trim()).filter(Boolean)))

  if (!ids.length) {
    throw createError({ statusCode: 400, message: 'ids[] is required' })
  }

  if (ids.length > 200) {
    throw createError({ statusCode: 400, message: 'Maximum 200 users per bulk operation' })
  }

  const action = body.action
  if (action !== 'enable' && action !== 'disable' && action !== 'role') {
    throw createError({ statusCode: 400, message: 'Invalid bulk action' })
  }

  const role = body.role
  if (action === 'role') {
    if (!isUserRole(role)) {
      throw createError({ statusCode: 400, message: 'Invalid role' })
    }
    if (role === 'superadmin') {
      throw createError({ statusCode: 400, message: 'The superadmin role is reserved for the seed admin account' })
    }
    assertCanCreateUserRole(actor, role)
  }

  const updatedIds: string[] = []
  const failed: Array<{ id: string, message: string }> = []

  await runWithConcurrency(ids, 6, async (id) => {
    try {
      const target = await findUserById(id)
      if (!target) {
        throw createError({ statusCode: 404, message: 'User not found' })
      }

      assertCanManageTargetUser(actor, target)

      if (action === 'disable') {
        assertNotSelf(actor, target, 'You cannot deactivate yourself')
        const user = await updateUser(target.id, { active: false })
        updatedIds.push(user.id)
        return
      }

      if (action === 'enable') {
        const user = await updateUser(target.id, { active: true })
        updatedIds.push(user.id)
        return
      }

      if (target.id === 'users:admin' && role !== 'superadmin') {
        throw createError({ statusCode: 400, message: 'The seed admin must remain a superadmin' })
      }

      const user = await updateUser(target.id, { role })
      updatedIds.push(user.id)
    } catch (error: any) {
      failed.push({ id, message: error?.statusMessage ?? error?.message ?? 'Unknown error' })
    }
  })

  return {
    updated: updatedIds.length,
    failed: failed.length,
    updated_ids: updatedIds,
    failures: failed
  }
})

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  const size = Math.max(1, Math.min(concurrency, items.length))
  let index = 0

  await Promise.all(Array.from({ length: size }, async () => {
    while (index < items.length) {
      const current = items[index]
      index += 1
      if (current !== undefined) {
        await worker(current)
      }
    }
  }))
}