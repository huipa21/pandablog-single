import { readBoundedJson } from '../../../utils/bounded-json'
import { requireOwner } from '../../../utils/auth'
import { assertCanCreateUserRole } from '../../../utils/user-management'
import { createUser, isUserRole, type UserRole } from '../../../utils/users'

export default defineEventHandler(async (event) => {
  const actor = await requireOwner(event)
  const body = await readBoundedJson(event, 8 * 1024)
  if (typeof body.username !== 'string' || body.username.length > 64 || typeof body.password !== 'string' || body.password.length > 200 || (body.role !== undefined && !isUserRole(body.role)) || (body.active !== undefined && typeof body.active !== 'boolean')) throw createError({statusCode: 400, message: 'Invalid user input'})
  const role = isUserRole(body.role) ? body.role : 'viewer' satisfies UserRole
  if (role === 'superadmin') {
    throw createError({ statusCode: 400, message: 'The superadmin role is reserved for the seed admin account' })
  }
  assertCanCreateUserRole(actor, role)

  const user = await createUser({
    username: body.username,
    password: body.password,
    role,
    display_name: typeof body.display_name === 'string' ? body.display_name : null,
    email: typeof body.email === 'string' ? body.email : null,
    active: body.active !== false
  })

  return { user }
})