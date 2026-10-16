import { requireOwner } from '../../../../utils/auth'
import { listTrustedDevices } from '../../../../utils/mfa/trusted-devices'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  return { devices: await listTrustedDevices(event, user.id) }
})