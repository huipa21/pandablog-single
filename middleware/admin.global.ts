export default defineNuxtRouteMiddleware(async (to) => {
  if (!to.path.startsWith('/admin')) {
    return
  }

  const sessionFetch = useSessionFetch()
  const setupStatus = await sessionFetch<{ completed: boolean }>('/api/auth/setup-status').catch(() => null)

  if (setupStatus && !setupStatus.completed && to.path !== '/admin/setup') {
    return navigateTo({ path: '/admin/setup', query: { redirect: to.fullPath } })
  }

  if (to.path === '/admin/setup') {
    if (setupStatus?.completed) {
      return navigateTo('/login')
    }
    return
  }

  if (to.path === '/admin/login') {
    return navigateTo({ path: '/login', query: { redirect: String(to.query.redirect ?? '/admin/dashboard') } })
  }

  if (to.path === '/login') {
    return
  }

  const session = await sessionFetch<{ loggedIn: boolean }>('/api/auth/session').catch(() => null)

  // Nuxt dev server restarts can briefly make API routes unavailable.
  // Do not force a logout redirect on transient transport/runtime errors.
  if (!session) {
    return
  }

  if (!session.loggedIn) {
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})