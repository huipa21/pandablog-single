import { requireOwner } from '../../../../utils/auth'
import { alertDetailsFromEvent, deliverTestAlert } from '../../../../utils/notify/security-alert'
import { getSecuritySettings } from '../../../../utils/settings'

/**
 * Send a one-off test alert to verify webhook configuration. Uses the URL from
 * the request body when provided (so an admin can test before saving),
 * otherwise the currently saved webhook URL.
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const body = await readBody<{ url?: string }>(event).catch((): { url?: string } => ({}))
  const provided = typeof body?.url === 'string' ? body.url.trim() : ''
  const url = provided || getSecuritySettings().security_alert_webhook_url

  if (!url) {
    throw createError({ statusCode: 400, message: 'No webhook URL configured' })
  }

  try {
    await deliverTestAlert(url, alertDetailsFromEvent(event, { reason: 'Manual test from admin settings' }))
  } catch (error) {
    console.warn('[security-alert] test webhook delivery failed:', error instanceof Error ? error.message : error)
    throw createError({
      statusCode: 400,
      message: 'Webhook delivery failed'
    })
  }

  return { ok: true }
})
