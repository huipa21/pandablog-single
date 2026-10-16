import { requireOwner } from '../../../utils/auth'
import { assertCanCreateUserRole, assertCanManageTargetUser } from '../../../utils/user-management'
import { findUserById, isUserRole, updateUser } from '../../../utils/users'

export default defineEventHandler(async (event) => {
  const actor = await requireOwner(event)
  const target = await findUserById(getRouterParam(event, 'id') ?? '')
  if (!target) {
    throw createError({ statusCode: 404, message: 'User not found' })
  }

  assertCanManageTargetUser(actor, target)
  const body = await readBody<Record<string, unknown>>(event)

  if (target.id === 'users:admin' && body.role && body.role !== 'superadmin') {
    throw createError({ statusCode: 400, message: 'The seed admin must remain a superadmin' })
  }
  if (target.id === actor.id && body.active === false) {
    throw createError({ statusCode: 400, message: 'You cannot deactivate yourself' })
  }

  const role = body.role === undefined ? undefined : body.role
  if (role !== undefined) {
    if (!isUserRole(role)) {
      throw createError({ statusCode: 400, message: 'Invalid role' })
    }
    if (role === 'superadmin' && target.id !== 'users:admin') {
      throw createError({ statusCode: 400, message: 'The superadmin role is reserved for the seed admin account' })
    }
    assertCanCreateUserRole(actor, role)
  }

  const user = await updateUser(target.id, {
    role,
    display_name: body.display_name === undefined ? undefined : typeof body.display_name === 'string' ? body.display_name : null,
    email: body.email === undefined ? undefined : typeof body.email === 'string' ? body.email : null,
    active: body.active === undefined ? undefined : body.active === true
  })

  return { user }
})