const EXCLUDED_PATH_PREFIXES = [
  '/admin',
  '/api',
  '/login',
  '/_nuxt',
  '/__nuxt'
]

export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()
  let lastTrackedPath = ''

  function track(path: string, referrer: string) {
    if (!shouldTrackPath(path) || path === lastTrackedPath) {
      return
    }

    lastTrackedPath = path
    const payload = JSON.stringify({ path, referrer })

    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' })
      if (navigator.sendBeacon('/api/analytics/track', blob)) {
        return
      }
    }

    void $fetch('/api/analytics/track', {
      method: 'POST',
      body: { path, referrer }
    }).catch(() => {})
  }

  nuxtApp.hook('app:mounted', () => {
    track(window.location.pathname + window.location.search, document.referrer)
  })

  router.afterEach((to, from) => {
    const referrer = from.fullPath && from.fullPath !== to.fullPath ? from.fullPath : document.referrer
    track(to.fullPath, referrer)
  })
})

function shouldTrackPath(path: string) {
  return path.startsWith('/') && !EXCLUDED_PATH_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`))
}
