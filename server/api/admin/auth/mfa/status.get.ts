import { requireOwner } from '../../../../utils/auth'
import { getUserMfaState } from '../../../../utils/mfa/store'

// Report the current user's MFA status for the settings UI.
export default defineEventHandler(async (event) => {
  const sessionUser = await requireOwner(event)
  const state = await getUserMfaState(sessionUser.id)

  return {
    enabled: Boolean(state?.enabled),
    enabled_at: state?.enabled_at ?? null,
    backup_codes_remaining: state?.backupCodes.length ?? 0
  }
})
