interface PublicSessionUser {
  id: string
  username: string
  display_name?: string | null
  avatar?: string | null
  avatar_url?: string | null
}

interface PublicAuthSession {
  loggedIn: boolean
  user: PublicSessionUser | null
}

const EMPTY_PUBLIC_AUTH_SESSION: PublicAuthSession = { loggedIn: false, user: null }

type PublicFetch = <T>(url: string) => Promise<T>

export function usePublicAuthSession() {
  return useAsyncData<PublicAuthSession>(
    'public-auth-session',
    async () => {
      if (import.meta.server && !hasServerSessionCookie()) {
        return EMPTY_PUBLIC_AUTH_SESSION
      }

      return fetchWithSession<PublicAuthSession>('/api/auth/session').catch(() => EMPTY_PUBLIC_AUTH_SESSION)
    },
    { default: () => EMPTY_PUBLIC_AUTH_SESSION }
  )
}

function hasServerSessionCookie() {
  const cookie = useRequestHeaders(['cookie']).cookie ?? ''
  return /(?:^|;\s*)nuxt-session=/.test(cookie)
}

function fetchWithSession<T>(url: string): Promise<T> {
  if (import.meta.server) {
    const requestFetch = useRequestFetch() as unknown as PublicFetch
    return requestFetch<T>(url)
  }

  const clientFetch = $fetch as unknown as PublicFetch
  return clientFetch<T>(url)
}