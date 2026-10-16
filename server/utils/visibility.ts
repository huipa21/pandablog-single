import type { H3Event } from 'h3'
import { queryDb, useDb } from './db'
import { getSessionUser } from './auth'
import { readUnlockedIds } from './post-password'
import { firstRow } from './surrealResult'

export type SiteVisibility = 'public' | 'private'
export type PostVisibility = 'public' | 'private' | 'password'

const SITE_VISIBILITY_CACHE_TTL_MS = 30_000

let cachedSiteVisibility: SiteVisibility | null = null
let cachedSiteVisibilityAt = 0
let cachedSiteVisibilityPromise: Promise<SiteVisibility> | null = null

export interface PostAccessInput {
  id: string
  visibility: PostVisibility
}

export type PostAccess =
  | { state: 'allow' }
  | { state: 'not-found' }
  | { state: 'locked', requiresPassword: true }
  | { state: 'site-private' }

export async function getSiteVisibility(): Promise<SiteVisibility> {
  const now = Date.now()
  if (cachedSiteVisibility && now - cachedSiteVisibilityAt < SITE_VISIBILITY_CACHE_TTL_MS) {
    return cachedSiteVisibility
  }

  if (cachedSiteVisibilityPromise) {
    return cachedSiteVisibilityPromise
  }

  cachedSiteVisibilityPromise = loadSiteVisibility()
    .then((mode) => {
      setCachedSiteVisibility(mode)
      return mode
    })
    .catch(() => cachedSiteVisibility ?? 'public')
    .finally(() => {
      cachedSiteVisibilityPromise = null
    })

  return cachedSiteVisibilityPromise
}

async function loadSiteVisibility(): Promise<SiteVisibility> {
  try {
    const db = await useDb()
    const result = await queryDb(db, 'SELECT * FROM app_settings:site_visibility;')

    const setting = firstRow<{ value?: unknown }>(result)
    const value = setting?.value
    return value === 'private' ? 'private' : 'public'
  } catch {
    return 'public'
  }
}

function setCachedSiteVisibility(mode: SiteVisibility) {
  cachedSiteVisibility = mode
  cachedSiteVisibilityAt = Date.now()
}

export function invalidateSiteVisibilityCache() {
  cachedSiteVisibility = null
  cachedSiteVisibilityAt = 0
  cachedSiteVisibilityPromise = null
}

export async function setSiteVisibility(mode: SiteVisibility): Promise<void> {
  if (mode !== 'public' && mode !== 'private') {
    throw createError({ statusCode: 400, message: 'Invalid mode' })
  }

  const db = await useDb()
  await queryDb(
    db,
    `UPSERT app_settings:site_visibility CONTENT {
      key: 'site_visibility',
      value: $mode,
      updated_at: time::now()
    };`,
    { mode }
  )
  setCachedSiteVisibility(mode)
}

export async function evaluatePostAccess(event: H3Event, post: PostAccessInput): Promise<PostAccess> {
  const user = await getSessionUser(event)
  if (user) return { state: 'allow' }

  const site = await getSiteVisibility()
  if (site === 'private') return { state: 'site-private' }

  if (post.visibility === 'public') return { state: 'allow' }
  if (post.visibility === 'private') return { state: 'not-found' }

  const unlocked = readUnlockedIds(event)
  if (unlocked.has(post.id)) return { state: 'allow' }

  return { state: 'locked', requiresPassword: true }
}

export function sanitizePost<T extends Record<string, unknown>>(post: T): T {
  const { password_hash: _passwordHash, ...rest } = post
  return rest as T
}
