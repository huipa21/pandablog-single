import { readBoundedJson } from '../../../utils/bounded-json'
import { queryDb, useDb } from '../../../utils/db'
import { requestAbortSignal } from '../../../utils/request-abort'
import { addUnlockedId, fakePostPasswordHash, verifyPostPassword } from '../../../utils/post-password'
import { reserveAuthAttempt } from '../../../utils/rate-limit'
import { getRuntimeFlags } from '../../../utils/settings'
import { stringifyRecordId } from '../../../utils/surrealResult'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug || slug.length > 256) {
    throw createError({ statusCode: 400, message: 'Missing slug' })
  }

  const body = await readBoundedJson(event, 8 * 1024)
  if (typeof body?.password !== 'string' || body.password.length > 200) throw createError({statusCode: 400, message: 'Invalid password input'})
  const password = body.password

  const runtimeFlags = getRuntimeFlags()
  const ip = getRequestIP(event, { xForwardedFor: runtimeFlags.trust_proxy_headers }) ?? null

  if (!ip && runtimeFlags.trust_proxy_headers) throw createError({ statusCode: 400, message: 'Could not resolve client IP' })
  const rate = await reserveAuthAttempt('unlock', ip ?? 'noip', slug)
  if (!rate.allowed) {
    setResponseHeader(event, 'Retry-After', rate.retryAfterSec)
    throw createError({ statusCode: 429, message: 'Too many unlock attempts' })
  }

  const db = await useDb()
  const response = await queryDb<[Array<{ id: string, visibility?: string, password_hash?: string | null }>]>(
    db,
    'SELECT id, visibility, password_hash FROM post WHERE slug = $slug AND status = "published" LIMIT 1;',
    { slug }
  )
  const post = response[0]?.[0]

  const effectiveHash = post?.password_hash || null
  const hashToCheck = effectiveHash ?? fakePostPasswordHash()
  const passwordOk = await verifyPostPassword(hashToCheck, password, requestAbortSignal(event))
  const isValid = !!post && post.visibility === 'password' && !!effectiveHash && passwordOk

  if (!isValid) {
    throw createError({ statusCode: 401, message: 'Incorrect password' })
  }

  addUnlockedId(event, stringifyRecordId(post.id))
  return { ok: true }
})
