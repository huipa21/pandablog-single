import { hashAdminPassword, verifyAdminPassword } from './admin-password'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

const COOKIE_NAME = 'pb_unlocked'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7
const HMAC_LABEL = 'pandablog:post-unlock:v1'
const FAKE_HASH = '$argon2id$v=19$m=65536,t=3,p=4$24FJyhtv+GvZe+OBX7WhuA$izl1gAgSi6XFKd07Qd9tXjyULm7rMyxhhPkl5TMuh8U'

interface UnlockedPayload {
  ids: string[]
  iat: number
}

function hmacKey(): Buffer {
  const config = useRuntimeConfig()
  const base = config.session.password as string | undefined
  if (!base) {
    throw new Error('Session password not configured; cannot sign post-unlock cookie')
  }
  return createHmac('sha256', base).update(HMAC_LABEL).digest()
}

function sign(payload: UnlockedPayload): string {
  const json = JSON.stringify(payload)
  const body = Buffer.from(json, 'utf8').toString('base64url')
  const sig = createHmac('sha256', hmacKey()).update(body).digest('base64url')
  return `${body}.${sig}`
}

function verify(value: string): UnlockedPayload | null {
  const dot = value.indexOf('.')
  if (dot < 0) return null

  const body = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  const expected = createHmac('sha256', hmacKey()).update(body).digest('base64url')

  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  try {
    const json = Buffer.from(body, 'base64url').toString('utf8')
    const parsed = JSON.parse(json) as UnlockedPayload
    if (!Array.isArray(parsed.ids)) return null
    if (typeof parsed.iat !== 'number') return null

    const ageSec = Math.floor(Date.now() / 1000) - parsed.iat
    if (ageSec > COOKIE_MAX_AGE) return null

    return parsed
  } catch {
    return null
  }
}

export function readUnlockedIds(event: H3Event): Set<string> {
  const raw = getCookie(event, COOKIE_NAME)
  if (!raw) return new Set()
  const payload = verify(raw)
  return new Set(payload?.ids ?? [])
}

export function hasUnlockedPostCookie(event: H3Event): boolean {
  return Boolean(getCookie(event, COOKIE_NAME))
}

export function addUnlockedId(event: H3Event, postId: string): void {
  const current = readUnlockedIds(event)
  current.add(postId)

  const payload: UnlockedPayload = {
    ids: Array.from(current).slice(-100),
    iat: Math.floor(Date.now() / 1000)
  }

  setCookie(event, COOKIE_NAME, sign(payload), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE,
    path: '/'
  })
}

export async function hashPostPassword(plain: string): Promise<string> {
  if (typeof plain !== 'string' || plain.length < 4) {
    throw createError({ statusCode: 400, message: 'Password must be at least 4 characters' })
  }

  if (plain.length > 200) {
    throw createError({ statusCode: 400, message: 'Password too long' })
  }

  return hashAdminPassword(plain)
}

export async function verifyPostPassword(hash: string, plain: string, signal?: AbortSignal): Promise<boolean> {
  return verifyAdminPassword(hash, plain, signal)
}

export function fakePostPasswordHash(): string {
  return FAKE_HASH
}
