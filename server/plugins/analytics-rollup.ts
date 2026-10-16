import { writeBarrier } from '../utils/maintenance'
import { cleanupAnalyticsRetention, rollupCompletedAnalyticsDays, shutdownAnalyticsMaintenance } from '../utils/analytics/rollup'
import { shutdownAnalyticsTracking } from '../utils/analytics/session'
import { analyticsReady } from '../utils/analytics/lifecycle'

export default defineNitroPlugin((nitro) => {
  let running: Promise<void> | undefined, lastCompletedDate = '', stopped = false
  const abort = new AbortController()
  const run = () => {
    const now = new Date(), date = `${writeBarrier.cacheGeneration()}:${now.toISOString().slice(0, 10)}`
    if (stopped || running || !analyticsReady() || writeBarrier.status().closed || lastCompletedDate === date) return
    running = writeBarrier.run(async () => {
      try {
        const result = await rollupCompletedAnalyticsDays(now, abort.signal)
        const reports = await cleanupAnalyticsRetention(now, abort.signal)
        if (result.completed && Object.values(reports).every(report => report.completed)) lastCompletedDate = date
        else console.warn('[analytics] maintenance incomplete; retry in one hour', {nextDay: result.nextDay, reports})
      } catch (error) {
        console.warn('[analytics] maintenance failed; retry in one hour:', error instanceof Error ? error.message : 'unavailable')
      }
    }, true).catch(() => {console.warn('[analytics] maintenance admission closed')}).finally(() => {running = undefined})
  }
  const boot = setTimeout(run, 60_000), timer = setInterval(run, 60 * 60_000)
  boot.unref?.(); timer.unref?.()
  nitro.hooks.hook('close', async () => {
    stopped = true; abort.abort(); clearTimeout(boot); clearInterval(timer)
    await Promise.all([shutdownAnalyticsMaintenance(), shutdownAnalyticsTracking()])
  })
})
