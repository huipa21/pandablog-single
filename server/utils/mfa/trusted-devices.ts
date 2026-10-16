import { createHash, randomBytes } from 'node:crypto'
import { isIP } from 'node:net'
import type { H3Event } from 'h3'
import { requestAbortSignal } from '../request-abort'
import { hashAdminPassword, verifyAdminPassword } from '../admin-password'
import { queryDb, useDb } from '../db'
import { queryRows, recordIdPart, stringifyRecordId } from '../surrealResult'
import { USERS_TABLE } from '../users'

const TRUSTED_DEVICES_TABLE = 'trusted_devices'
const TRUSTED_DEVICE_COOKIE = 'pb-td'
const TRUSTED_DEVICE_MAX_AGE_SEC = 30 * 24 * 60 * 60
const TRUSTED_DEVICE_TTL_MS = TRUSTED_DEVICE_MAX_AGE_SEC * 1000
const TOKEN_BYTES = 32

export interface TrustedDeviceContext {
  userAgent: string | null
  uaHash: string
  ip: string | null
  ipPrefix: string | null
}

export interface TrustedDeviceRecord {
  id: string
  userId: string
  tokenHash: string
  authEpoch: string
  label: string
  userAgent: string | null
  uaHash: string
  ip: string | null
  ipPrefix: string | null
  createdAt: string
  lastUsedAt: string
  expiresAt: string
}

export interface TrustedDeviceListItem {
  id: string
  label: string
  userAgent: string | null
  ip: string | null
  ipPrefix: string | null
  createdAt: string
  lastUsedAt: string
  expiresAt: string
  current: boolean
}

interface TrustedDeviceRow {
  id?: unknown
  user?: unknown
  token_hash?: unknown
  auth_epoch?: unknown
  label?: unknown
  user_agent?: unknown
  ua_hash?: unknown
  ip?: unknown
  ip_prefix?: unknown
  created_at?: unknown
  last_used_at?: unknown
  expires_at?: unknown
}

interface TrustedDeviceCookie {
  id: string
  secret: string
}

function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function normalizeUserId(idOrRecord: string): string {
  const id = recordIdPart(idOrRecord, USERS_TABLE)
  if (!id) {
    throw createError({ statusCode: 400, message: 'Invalid user reference' })
  }
  return id
}

function serializeDate(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return String(value ?? '')
}

/**
 * Compute the trusted-device expiry as a JS `Date`. SurrealDB's schemafull
 * `datetime` fields reject raw ISO strings via parameter binding, so this MUST
 * be bound as a `Date` (see `toDatetime()` in `server/utils/content.ts`).
 */
export function trustedDeviceExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + TRUSTED_DEVICE_TTL_MS)
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function mapTrustedDeviceRow(row: TrustedDeviceRow): TrustedDeviceRecord | null {
  const id = row.id ? stringifyRecordId(row.id) : ''
  const user = row.user ? stringifyRecordId(row.user) : ''
  const tokenHash = optionalString(row.token_hash)
  const uaHash = optionalString(row.ua_hash)
  const label = optionalString(row.label)
  const expiresAt = serializeDate(row.expires_at)
  if (!id || !user || !tokenHash || !uaHash || !label || !expiresAt || typeof row.auth_epoch !== 'string' || !/^[a-f0-9]{48}$/.test(row.auth_epoch)) {
    return null
  }

  return {
    id,
    userId: recordIdPart(user, USERS_TABLE),
    tokenHash,
    authEpoch: row.auth_epoch,
    label,
    userAgent: optionalString(row.user_agent),
    uaHash,
    ip: optionalString(row.ip),
    ipPrefix: optionalString(row.ip_prefix),
    createdAt: serializeDate(row.created_at),
    lastUsedAt: serializeDate(row.last_used_at),
    expiresAt
  }
}

function randomSecret(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

function setTrustedDeviceCookie(event: H3Event, deviceId: string, secret: string): void {
  setCookie(event, TRUSTED_DEVICE_COOKIE, `${encodeURIComponent(deviceId)}.${secret}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TRUSTED_DEVICE_MAX_AGE_SEC,
    path: '/'
  })
}

function clearTrustedDeviceCookie(event: H3Event): void {
  deleteCookie(event, TRUSTED_DEVICE_COOKIE, { path: '/' })
}

function readTrustedDeviceCookie(event: H3Event): TrustedDeviceCookie | null {
  const raw = getCookie(event, TRUSTED_DEVICE_COOKIE)
  if (!raw) return null

  const separator = raw.indexOf('.')
  if (separator <= 0) return null

  const id = decodeURIComponent(raw.slice(0, separator))
  const secret = raw.slice(separator + 1)
  if (!recordIdPart(id, TRUSTED_DEVICES_TABLE) || !secret) return null
  return { id, secret }
}

export function trustedDeviceIpPrefix(ip: string | null): string | null {
  if (!ip) return null

  if (isIP(ip) === 4) {
    const parts = ip.split('.')
    if (parts.length !== 4) return null
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`
  }

  if (isIP(ip) === 6) {
    const segments = ip.toLowerCase().split(':')
    return `${segments.slice(0, 3).join(':')}::/48`
  }

  return null
}

export function deriveDeviceLabel(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device'

  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent) || /CriOS\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser'

  const platform = /Windows NT/.test(userAgent)
    ? 'Windows'
    : /Mac OS X/.test(userAgent)
      ? 'macOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /iPhone|iPad|iPod/.test(userAgent)
          ? 'iOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : 'Unknown OS'

  return `${browser} on ${platform}`
}

export async function resolveTrustedDeviceContext(event: H3Event): Promise<TrustedDeviceContext> {
  const runtimeFlags = getRuntimeFlags()
  const ip = getRequestIP(event, { xForwardedFor: runtimeFlags.trust_proxy_headers }) ?? null
  const userAgent = getHeader(event, 'user-agent')?.slice(0, 512) || null

  return {
    userAgent,
    uaHash: hashString(userAgent ?? ''),
    ip,
    ipPrefix: trustedDeviceIpPrefix(ip)
  }
}

export function trustedDeviceContextMatches(device: TrustedDeviceRecord, context: TrustedDeviceContext): boolean {
  if (device.uaHash !== context.uaHash) {
    return false
  }

  if (device.ipPrefix && context.ipPrefix) {
    return device.ipPrefix === context.ipPrefix
  }

  return !device.ipPrefix && !context.ipPrefix
}

export async function findMatchingTrustedDevice(event: H3Event, idOrUserRecord: string): Promise<TrustedDeviceRecord | null> {
  const cookie = readTrustedDeviceCookie(event)
  if (!cookie) return null

  const userId = normalizeUserId(idOrUserRecord)
  const deviceId = recordIdPart(cookie.id, TRUSTED_DEVICES_TABLE)
  const db = await useDb()
  const response = await queryDb(
    db,
    `SELECT * FROM trusted_devices
      WHERE id = type::record($table, $id)
        AND user = type::record($userTable, $userId)
        AND expires_at > time::now()
        AND auth_epoch IS NOT NONE AND auth_epoch = user.auth_epoch AND user.active = true
      LIMIT 1;`,
    { table: TRUSTED_DEVICES_TABLE, id: deviceId, userTable: USERS_TABLE, userId }
  )

  const row = queryRows<TrustedDeviceRow>(response)[0]
  const device = row ? mapTrustedDeviceRow(row) : null
  if (!device || !await verifyAdminPassword(device.tokenHash, cookie.secret, requestAbortSignal(event))) {
    clearTrustedDeviceCookie(event)
    return null
  }

  return device
}

export async function issueTrustedDevice(
  event: H3Event,
  idOrUserRecord: string,
  context: TrustedDeviceContext | undefined,
  authEpoch: string
): Promise<TrustedDeviceRecord> {
  if (!/^[a-f0-9]{48}$/.test(authEpoch)) throw createError({statusCode: 401, message: 'Authentication required'})
  const userId = normalizeUserId(idOrUserRecord)
  const secret = randomSecret()
  const tokenHash = await hashAdminPassword(secret, requestAbortSignal(event))
  const deviceContext = context ?? await resolveTrustedDeviceContext(event)
  const db = await useDb()
  const response = await queryDb(
    db,
    `CREATE trusted_devices CONTENT {
      user: type::record($userTable, $userId),
      token_hash: $tokenHash,
      auth_epoch: $authEpoch,
      label: $label,
      user_agent: (IF $userAgent != NONE AND $userAgent != '' THEN $userAgent ELSE NONE END),
      ua_hash: $uaHash,
      ip: (IF $ip != NONE AND $ip != '' THEN $ip ELSE NONE END),
      ip_prefix: (IF $ipPrefix != NONE AND $ipPrefix != '' THEN $ipPrefix ELSE NONE END),
      created_at: time::now(),
      last_used_at: time::now(),
      expires_at: $expiresAt
    } RETURN AFTER;`,
    {
      userTable: USERS_TABLE,
      userId,
      tokenHash,
      authEpoch,
      label: deriveDeviceLabel(deviceContext.userAgent),
      userAgent: deviceContext.userAgent ?? '',
      uaHash: deviceContext.uaHash,
      ip: deviceContext.ip ?? '',
      ipPrefix: deviceContext.ipPrefix ?? '',
      expiresAt: trustedDeviceExpiry()
    }
  )

  const row = queryRows<TrustedDeviceRow>(response)[0]
  const device = row ? mapTrustedDeviceRow(row) : null
  if (!device) {
    throw createError({ statusCode: 500, message: 'Could not create trusted device' })
  }

  setTrustedDeviceCookie(event, device.id, secret)
  return device
}

export async function refreshTrustedDevice(
  event: H3Event,
  device: TrustedDeviceRecord,
  context: TrustedDeviceContext,
  options: { rebind?: boolean } = {}
): Promise<void> {
  const deviceId = recordIdPart(device.id, TRUSTED_DEVICES_TABLE)
  const secret = randomSecret()
  const tokenHash = await hashAdminPassword(secret, requestAbortSignal(event))
  const db = await useDb()
  const refreshed = await queryDb(
    db,
    `UPDATE type::record($table, $id) MERGE {
      token_hash: $tokenHash,
      last_used_at: time::now(),
      expires_at: $expiresAt,
      user_agent: (IF $rebind AND $userAgent != NONE AND $userAgent != '' THEN $userAgent ELSE user_agent END),
      ua_hash: (IF $rebind THEN $uaHash ELSE ua_hash END),
      ip: (IF $rebind AND $ip != NONE AND $ip != '' THEN $ip ELSE ip END),
      ip_prefix: (IF $rebind AND $ipPrefix != NONE AND $ipPrefix != '' THEN $ipPrefix ELSE ip_prefix END)
    } WHERE auth_epoch = $authEpoch AND auth_epoch = user.auth_epoch AND user.active = true RETURN AFTER;`,
    {
      table: TRUSTED_DEVICES_TABLE,
      id: deviceId,
      tokenHash,
      expiresAt: trustedDeviceExpiry(),
      rebind: options.rebind === true,
      authEpoch: device.authEpoch,
      userAgent: context.userAgent ?? '',
      uaHash: context.uaHash,
      ip: context.ip ?? '',
      ipPrefix: context.ipPrefix ?? ''
    }
  )
  if (!queryRows(refreshed).length) { clearTrustedDeviceCookie(event); throw createError({statusCode: 401, message: 'Trusted device revoked'}) }
  setTrustedDeviceCookie(event, device.id, secret)
}

export async function rebindCurrentTrustedDevice(event: H3Event, idOrUserRecord: string, context: TrustedDeviceContext): Promise<boolean> {
  const device = await findMatchingTrustedDevice(event, idOrUserRecord)
  if (!device) return false
  await refreshTrustedDevice(event, device, context, { rebind: true })
  return true
}

export async function listTrustedDevices(event: H3Event, idOrUserRecord: string): Promise<TrustedDeviceListItem[]> {
  const userId = normalizeUserId(idOrUserRecord)
  const cookie = readTrustedDeviceCookie(event)
  const currentId = cookie ? stringifyRecordId(cookie.id) : ''
  const db = await useDb()
  const response = await queryDb(
    db,
    `SELECT * FROM trusted_devices
      WHERE user = type::record($userTable, $userId) AND expires_at > time::now()
        AND auth_epoch IS NOT NONE AND auth_epoch = user.auth_epoch AND user.active = true
      ORDER BY last_used_at DESC;`,
    { userTable: USERS_TABLE, userId }
  )

  return queryRows<TrustedDeviceRow>(response)
    .map(row => mapTrustedDeviceRow(row))
    .filter((device): device is TrustedDeviceRecord => Boolean(device))
    .map(device => ({
      id: device.id,
      label: device.label,
      userAgent: device.userAgent,
      ip: device.ip,
      ipPrefix: device.ipPrefix,
      createdAt: device.createdAt,
      lastUsedAt: device.lastUsedAt,
      expiresAt: device.expiresAt,
      current: Boolean(currentId && stringifyRecordId(device.id) === currentId)
    }))
}

export async function revokeTrustedDevice(event: H3Event, idOrUserRecord: string, idOrDeviceRecord: string): Promise<void> {
  const userId = normalizeUserId(idOrUserRecord)
  const deviceId = recordIdPart(idOrDeviceRecord, TRUSTED_DEVICES_TABLE)
  const cookie = readTrustedDeviceCookie(event)
  const db = await useDb()
  await queryDb(
    db,
    `DELETE FROM trusted_devices
      WHERE id = type::record($table, $id) AND user = type::record($userTable, $userId);`,
    { table: TRUSTED_DEVICES_TABLE, id: deviceId, userTable: USERS_TABLE, userId }
  )

  if (cookie && recordIdPart(cookie.id, TRUSTED_DEVICES_TABLE) === deviceId) {
    clearTrustedDeviceCookie(event)
  }
}

export async function revokeAllTrustedDevices(event: H3Event, idOrUserRecord: string): Promise<void> {
  const userId = normalizeUserId(idOrUserRecord)
  const db = await useDb()
  await queryDb(
    db,
    'DELETE FROM trusted_devices WHERE user = type::record($userTable, $userId);',
    { userTable: USERS_TABLE, userId }
  )
  clearTrustedDeviceCookie(event)
}

export async function renameTrustedDevice(idOrUserRecord: string, idOrDeviceRecord: string, label: string): Promise<void> {
  const normalized = label.trim().slice(0, 80)
  if (!normalized) {
    throw createError({ statusCode: 400, message: 'Device name is required' })
  }

  const userId = normalizeUserId(idOrUserRecord)
  const deviceId = recordIdPart(idOrDeviceRecord, TRUSTED_DEVICES_TABLE)
  const db = await useDb()
  await queryDb(
    db,
    `UPDATE trusted_devices SET label = $label
      WHERE id = type::record($table, $id) AND user = type::record($userTable, $userId);`,
    { table: TRUSTED_DEVICES_TABLE, id: deviceId, userTable: USERS_TABLE, userId, label: normalized }
  )
}