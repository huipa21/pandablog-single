import { useDb } from '../../../utils/db'
import { requireOwner } from '../../../utils/auth'
import { getMediaSettings } from '../../../utils/settings'
import { mediaDashboard, type MediaDashboardRange } from '../../../utils/media-dashboard'

const presets = new Set(['today', '7d', '30d', '90d', 'all', 'custom'])
export default defineEventHandler(async (event) => {
  const user = await requireOwner(event), query = getQuery(event)
  const range = typeof query.range === 'string' && presets.has(query.range) ? query.range : 'all'
  const window = rangeWindow(range, query.from, query.to)
  const [db, settings] = await Promise.all([useDb(), getMediaSettings()])
  const thresholdMb = settings.oversized_image_threshold_mb > 0 ? settings.oversized_image_threshold_mb : settings.max_file_size_mb / 10
  return await mediaDashboard(db, user, window, Math.round(thresholdMb * 1024 * 1024))
})
function rangeWindow(range: string, from: unknown, to: unknown): MediaDashboardRange {
  const now = new Date()
  if (range === 'all') return {range, start: null, end: now}
  const start = new Date(now)
  start.setDate(start.getDate() - (range === 'today' ? 1 : range === '90d' ? 90 : range === '30d' ? 30 : 7) + 1)
  start.setHours(0, 0, 0, 0)
  if (range !== 'custom') return {range, start, end: now}
  const customStart = boundary(from, false) ?? start, end = boundary(to, true) ?? now
  if (end < customStart) {end.setTime(customStart.getTime()); end.setHours(23, 59, 59, 999)}
  return {range, start: customStart, end}
}
function boundary(value: unknown, end: boolean) {
  if (typeof value !== 'string' || !value.trim()) return null
  if (value.length > 40) throw createError({statusCode: 400, message: 'Invalid media dashboard date'})
  const raw = value.trim(), dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  const date = dateOnly ? new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0) : new Date(raw)
  return Number.isNaN(date.getTime()) ? null : date
}
