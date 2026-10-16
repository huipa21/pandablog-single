import { randomBytes } from 'node:crypto'
import { mediaReserveReferences } from './referenceTracker'
import { adminPasswordProblem, hashAdminPassword, verifyAdminPassword } from './admin-password'
import { queryDb, queryDbRecord, useDb } from './db'
import { firstRow, queryRows, recordIdPart, stringifyRecordId } from './surrealResult'

export const USERS_TABLE = 'users'
export const OWNER_ID = 'users:admin'

export interface UserRecord {
  id: string
  username: string
  display_name: string | null
  email: string | null
  avatar: string | null
  avatar_url: string | null
  active: boolean
  last_login_at: string | null
  created_at: string
  updated_at: string
}

export interface UserWithPassword extends UserRecord {
  password_hash: string
  auth_epoch: string
}
export function newAuthEpoch() { return randomBytes(24).toString('hex') }
export type AuthAccount = SessionUser & { active: boolean, auth_epoch: string }

export async function findAuthAccountById(value: string): Promise<AuthAccount | null> {
  if (value !== OWNER_ID) return null
  const db = await useDb()
  const row = firstRow<Record<string, unknown>>(await queryDb(db,
    'SELECT id, username, active, auth_epoch, display_name, avatar FROM type::record($table, $id);',
    {table: USERS_TABLE, id: recordIdPart(value, USERS_TABLE)}, {retryOnReconnect: false, label: 'current identity lookup'}))
  if (!row || typeof row.auth_epoch !== 'string' || !/^[a-f0-9]{48}$/.test(row.auth_epoch)) return null
  return {...toSessionUser(normalizeUser(row)), active: row.active === true, auth_epoch: row.auth_epoch}
}

export interface SessionUser {
  id: string
  username: string
  display_name?: string | null
  avatar?: string | null
  avatar_url?: string | null
}

interface UpdateUserInput {
  display_name?: string | null
  email?: string | null
  avatar?: string | null
}

export function normalizeUsername(value: unknown) {
  const username = String(value ?? '').trim().toLowerCase()
  if (!username) {
    throw createError({ statusCode: 400, message: 'Username is required' })
  }
  if (username.length < 3) {
    throw createError({ statusCode: 400, message: 'Username must be at least 3 characters' })
  }
  if (username.length > 64) {
    throw createError({ statusCode: 400, message: 'Username must be 64 characters or fewer' })
  }
  if (!/^[a-z0-9._-]+$/.test(username)) {
    throw createError({ statusCode: 400, message: 'Username can only contain letters, numbers, dots, underscores, or hyphens' })
  }

  return username
}

export function userRecordId(username: string) {
  return normalizeUsername(username)
}

export function validateUserPassword(password: string) {
  const problem = adminPasswordProblem(password)
  if (problem) {
    throw createError({ statusCode: 400, message: problem })
  }
}

export async function hashUserPassword(password: string) {
  validateUserPassword(password)
  return hashAdminPassword(password)
}

export async function verifyUserPassword(user: UserWithPassword | null, password: string, signal?: AbortSignal) {
  if (!user?.password_hash) {
    return false
  }

  return verifyAdminPassword(user.password_hash, password, signal)
}

export function normalizeUser(record: Record<string, unknown>): UserRecord {
  const avatar = normalizeAvatarRecordId(record.avatar, false)
  return {
    id: stringifyRecordId(record.id),
    username: String(record.username ?? ''),
    display_name: stringOrNull(record.display_name),
    email: stringOrNull(record.email),
    avatar,
    avatar_url: avatar ? avatarUrlFromRecordId(avatar) : null,
    active: record.active !== false,
    last_login_at: serializeDate(record.last_login_at),
    created_at: serializeDate(record.created_at) ?? new Date().toISOString(),
    updated_at: serializeDate(record.updated_at) ?? new Date().toISOString()
  }
}

export function normalizeUserWithPassword(record: Record<string, unknown>): UserWithPassword {
  return {
    ...normalizeUser(record),
    password_hash: String(record.password_hash ?? ''),
    auth_epoch: typeof record.auth_epoch === 'string' ? record.auth_epoch : ''
  }
}

export function toSessionUser(user: UserRecord): SessionUser {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    avatar: user.avatar,
    avatar_url: user.avatar_url
  }
}

export async function findUserByUsername(username: string): Promise<UserWithPassword | null> {
  const db = await useDb()
  const response = await queryDb(db, 'SELECT * FROM users WHERE username = $username LIMIT 1;', {
    username: normalizeUsername(username)
  })

  const row = firstRow<Record<string, unknown>>(response)
  return row ? normalizeUserWithPassword(row) : null
}

export async function findUserById(value: string): Promise<UserWithPassword | null> {
  const id = recordIdPart(value, USERS_TABLE)
  if (!id) return null

  const db = await useDb()
  const row = await queryDbRecord(db, USERS_TABLE, id)
  return row ? normalizeUserWithPassword(row) : null
}

export async function updateUser(idOrUsername: string, input: UpdateUserInput): Promise<UserRecord> {
  const id = recordIdPart(idOrUsername, USERS_TABLE) || userRecordId(idOrUsername)
  const updates = ['updated_at: time::now()']
  const params: Record<string, unknown> = {
    table: USERS_TABLE,
    id
  }

  if (input.display_name !== undefined) {
    const displayName = stringOrNull(input.display_name)
    updates.push(`display_name: ${optionalParamExpression(displayName, 'displayName')}`)
    params.displayName = displayName
  }
  if (input.email !== undefined) {
    const email = stringOrNull(input.email)
    updates.push(`email: ${optionalParamExpression(email, 'email')}`)
    params.email = email
  }
  if (input.avatar !== undefined) {
    const avatar = normalizeAvatarInput(input.avatar)
    updates.push(`avatar: ${avatar.expression}`)
    Object.assign(params, avatar.params)
  }

  const db = await useDb()
  if (input.avatar) await mediaReserveReferences(db, `users:${id}`, [input.avatar])
  const response = await queryDb(db, `UPDATE type::record($table, $id) MERGE { ${updates.join(', ')} };`, params, {retryOnReconnect: false})

  const row = firstRow<Record<string, unknown>>(response)
  if (!row) {
    throw createError({ statusCode: 404, message: 'User not found' })
  }

  return normalizeUser(row)
}

export async function setUserPassword(idOrUsername: string, password: string, expectedEpoch?: string): Promise<void> {
  await setUserPasswordHash(idOrUsername, await hashUserPassword(password), expectedEpoch)
}

export async function setUserPasswordHash(idOrUsername: string, passwordHash: string, expectedEpoch?: string): Promise<void> {
  if (!passwordHash) {
    throw createError({ statusCode: 400, message: 'Password hash is required' })
  }

  const id = recordIdPart(idOrUsername, USERS_TABLE) || userRecordId(idOrUsername)
  const db = await useDb()
  const response = await queryDb(db, `UPDATE type::record($table, $id) MERGE { password_hash: $passwordHash, auth_epoch: $authEpoch, updated_at: time::now() } ${expectedEpoch ? 'WHERE active = true AND auth_epoch = $expectedEpoch' : ''};`, {
    table: USERS_TABLE,
    id,
    passwordHash,
    authEpoch: newAuthEpoch(),
    expectedEpoch
  }, {retryOnReconnect: false})

  if (!firstRow<Record<string, unknown>>(response)) {
    throw createError({ statusCode: 404, message: 'User not found' })
  }
}

export async function touchUserLogin(userId: string): Promise<void> {
  const id = recordIdPart(userId, USERS_TABLE)
  if (!id) return

  const db = await useDb()
  await queryDb(db, 'UPDATE type::record($table, $id) MERGE { last_login_at: time::now(), updated_at: time::now() };', {
    table: USERS_TABLE,
    id
  })
}

function stringOrNull(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || null
}

function optionalParamExpression(value: unknown, name: string) {
  return value === null || value === undefined || value === '' ? 'NONE' : `$${name}`
}

function normalizeAvatarInput(value: unknown) {
  const avatar = normalizeAvatarRecordId(value, true)

  if (!avatar) {
    return { expression: 'NONE', params: {} }
  }

  return {
    expression: 'type::record($avatarTable, $avatarId)',
    params: {
      avatarTable: 'files',
      avatarId: recordIdPart(avatar, 'files')
    }
  }
}

function normalizeAvatarRecordId(value: unknown, strict: boolean) {
  if (!value) return null

  const recordId = stringifyRecordId(value)
  const id = recordIdPart(recordId, 'files').trim()
  if (!/^[a-f0-9]{64}$/i.test(id)) {
    if (strict) {
      throw createError({ statusCode: 400, message: 'Avatar must reference an existing media record' })
    }
    return null
  }

  return `files:${id.toLowerCase()}`
}

function avatarUrlFromRecordId(value: string) {
  return `/media/${encodeURIComponent(recordIdPart(value, 'files'))}`
}

function serializeDate(value: unknown): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  return String(value)
}