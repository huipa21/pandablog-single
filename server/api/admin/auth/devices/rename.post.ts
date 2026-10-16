import { readBoundedJson } from '../../../../utils/bounded-json'
import { requireOwner } from '../../../../utils/auth'
import { renameTrustedDevice } from '../../../../utils/mfa/trusted-devices'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  const body = await readBoundedJson(event, 8 * 1024)
  if (typeof body.id !== 'string' || body.id.length > 128 || typeof body.label !== 'string' || body.label.length > 80) throw createError({statusCode: 400, message: 'Invalid device input'})
  const id = String(body?.id ?? '')
  const label = String(body?.label ?? '')
  if (!id) {
    throw createError({ statusCode: 400, message: 'Device id is required' })
  }

  await renameTrustedDevice(user.id, id, label)
  return { ok: true }
})