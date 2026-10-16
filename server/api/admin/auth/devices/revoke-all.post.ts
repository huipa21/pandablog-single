import { readBoundedJson } from '../../../../utils/bounded-json'
import { requireOwner } from '../../../../utils/auth'
import { revokeAllTrustedDevices } from '../../../../utils/mfa/trusted-devices'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  await readBoundedJson(event, 8 * 1024)
  await revokeAllTrustedDevices(event, user.id)
  return { ok: true }
})