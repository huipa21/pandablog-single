import { randomBytes } from 'node:crypto'
import { mediaReserveReferences } from './referenceTracker'
import { queryDb, useDb } from './db'
import { queryRows } from './surrealResult'
import type { JsonContent } from '~/types/content'
import { ADMIN_LOCALE_KEY, normalizeAdminLocale, type SupportedLocale } from '~/utils/adminLocale'
import {
  ADMIN_DATE_FORMAT_KEY,
  ADMIN_FORMAT_LOCALE_KEY,
  ADMIN_TIMEZONE_KEY,
  normalizeAdminDateFormat,
  normalizeAdminFormatLocale,
  normalizeAdminTimezone,
  type AdminDateFormat,
  type AdminFormatLocale,
  type AdminTimezone
} from '~/utils/systemSettings'
import { ADMIN_COLOR_MODE_KEY, normalizeThemeMode, type ThemeMode } from '~/utils/themeMode'
import { ADMIN_POST_DISPLAY_MODE_KEY, normalizeAdminPostDisplayMode, type AdminPostDisplayMode } from './posts'

export const PUBLIC_SETTING_KEYS = [
  'site_title',
  'site_subtitle',
  'site_logo',
  'site_banner',
  'site_banner_position_x',
  'site_banner_position_y',
  'site_banner_zoom',
  'site_hero_height_vh',
  'site_favicon',
  'owner_name',
  'owner_avatar',
  'owner_motto',
  'owner_bio',
  'owner_bio_visible',
  'footer_copyright',
  'footer_links',
  'footer_social',
  'footer_filings',
  'footer_show_powered_by',
  'graph_view_enabled',
  'publish_heatmap_enabled'
] as const

export const RUNTIME_SETTING_KEYS = [
  'trust_proxy_headers'
] as const

const ADMIN_ONLY_SETTING_KEYS = [
  ADMIN_COLOR_MODE_KEY,
  ADMIN_LOCALE_KEY,
  ADMIN_DATE_FORMAT_KEY,
  ADMIN_TIMEZONE_KEY,
  ADMIN_FORMAT_LOCALE_KEY,
  ADMIN_POST_DISPLAY_MODE_KEY,
  'post_versioning'
] as const

export const ANALYTICS_SETTING_KEYS = [
  'analytics_enabled',
  'analytics_session_window_minutes',
  'analytics_retention_days'
] as const

export const ANALYTICS_HASH_SALT_KEY = 'analytics_hash_salt'

export const SECURITY_SETTING_KEYS = [
  'security_alerts_enabled',
  'security_alert_webhook_url',
  'security_alert_on_failed_login',
  'security_alert_on_lockout',
  'security_alert_on_new_login',
  'security_mfa_required_for_admins'
] as const

export const ADMIN_SETTING_KEYS = [
  ...PUBLIC_SETTING_KEYS,
  ...RUNTIME_SETTING_KEYS,
  ...ADMIN_ONLY_SETTING_KEYS,
  ...ANALYTICS_SETTING_KEYS,
  ...SECURITY_SETTING_KEYS
] as const

const SECRET_SETTING_KEYS = [
  'admin_password_hash',
  '__setup_claim',
  ANALYTICS_HASH_SALT_KEY
] as const

export const ADMIN_USERNAME = 'admin'
const SETUP_COMPLETED_KEY = 'setup_completed'

export type PublicSettingKey = typeof PUBLIC_SETTING_KEYS[number]
export type RuntimeSettingKey = typeof RUNTIME_SETTING_KEYS[number]
export type ThemeModeSetting = ThemeMode
export type AdminLocaleSetting = SupportedLocale
export type AdminDateFormatSetting = AdminDateFormat
export type AdminTimezoneSetting = AdminTimezone
export type AdminFormatLocaleSetting = AdminFormatLocale
export type AdminPostDisplayModeSetting = AdminPostDisplayMode
export type AnalyticsSettingKey = typeof ANALYTICS_SETTING_KEYS[number]
export type SecuritySettingKey = typeof SECURITY_SETTING_KEYS[number]

export interface RuntimeFlags {
  trust_proxy_headers: boolean
}

export interface AnalyticsSettings {
  analytics_enabled: boolean
  analytics_session_window_minutes: number
  analytics_retention_days: number
}

export interface SecuritySettings {
  security_alerts_enabled: boolean
  security_alert_webhook_url: string
  security_alert_on_failed_login: boolean
  security_alert_on_lockout: boolean
  security_alert_on_new_login: boolean
  security_mfa_required_for_admins: boolean
}

const APP_SETTINGS_TABLE = 'app_settings'
// SECURITY: when true, the client IP is read from X-Forwarded-For. That IP
// drives login lockout and the public rate limiters, so only keep this enabled
// behind a trusted proxy that overwrites X-Forwarded-For. Set false if the app
// is directly internet-exposed, or clients can spoof their IP. See README
// "Security And Reverse Proxy".
const DEFAULT_RUNTIME_FLAGS: RuntimeFlags = {
  trust_proxy_headers: true
}
const DEFAULT_ANALYTICS_SETTINGS: AnalyticsSettings = {
  analytics_enabled: false,
  analytics_session_window_minutes: 30,
  analytics_retention_days: 90
}
const DEFAULT_SECURITY_SETTINGS: SecuritySettings = {
  security_alerts_enabled: false,
  security_alert_webhook_url: '',
  security_alert_on_failed_login: false,
  security_alert_on_lockout: true,
  security_alert_on_new_login: false,
  security_mfa_required_for_admins: false
}

export interface SettingsLink {
  label: string
  url: string
  icon?: string
}

export interface PublicSiteSettings {
  site_title: string
  site_subtitle: string
  site_logo: string
  site_banner: string
  site_banner_position_x: number
  site_banner_position_y: number
  site_banner_zoom: number
  site_hero_height_vh: number
  site_favicon: string
  owner_name: string
  owner_avatar: string
  owner_motto: string
  owner_bio: JsonContent | null
  owner_bio_visible: boolean
  footer_copyright: string
  footer_links: SettingsLink[]
  footer_social: SettingsLink[]
  footer_filings: SettingsLink[]
  footer_show_powered_by: boolean
  graph_view_enabled: boolean
  publish_heatmap_enabled: boolean
}

const publicSettingKeySet = new Set<string>(PUBLIC_SETTING_KEYS)
const runtimeSettingKeySet = new Set<string>(RUNTIME_SETTING_KEYS)
const analyticsSettingKeySet = new Set<string>(ANALYTICS_SETTING_KEYS)
const securitySettingKeySet = new Set<string>(SECURITY_SETTING_KEYS)
const secretSettingKeySet = new Set<string>(SECRET_SETTING_KEYS)

let runtimeFlagsCache: RuntimeFlags = { ...DEFAULT_RUNTIME_FLAGS }
let analyticsSettingsCache: AnalyticsSettings = { ...DEFAULT_ANALYTICS_SETTINGS }
let securitySettingsCache: SecuritySettings = { ...DEFAULT_SECURITY_SETTINGS }

async function readRawAppSettings(keys: readonly string[]): Promise<Record<string, unknown>> {
  const db = await useDb()
  const response = await queryDb(db, 'SELECT * FROM app_settings;')
  const wanted = new Set(keys)
  const settings: Record<string, unknown> = {}

  for (const row of queryRows<Record<string, unknown>>(response)) {
    const key = String(row.key ?? '')
    if (wanted.has(key)) {
      settings[key] = row.value
    }
  }

  return settings
}

export async function readAppSettings(keys: readonly string[] = PUBLIC_SETTING_KEYS): Promise<Record<string, unknown>> {
  const settings = await readRawAppSettings(keys)
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !secretSettingKeySet.has(key))
  )
}

export async function writeAppSettings(values: Record<string, unknown>, keys: readonly string[] = PUBLIC_SETTING_KEYS): Promise<void> {
  const allowed = new Set(keys)
  const entries = Object.entries(values).filter(([key]) => allowed.has(key))

  if (!entries.length) {
    return
  }

  const db = await useDb()
  for (const [key, value] of entries) {
    // Public logo/banner/favicon/avatar/bio/footer references must remain public.
    // Wrap arbitrary settings values so literal hashes are not mistaken for
    // media IDs, and never scan secret/admin-only setting material.
    if (publicSettingKeySet.has(key)) await mediaReserveReferences(db, `app_settings:${key}`, [{value}])
  }
  for (const [key, value] of entries) {
    await upsertAppSetting(db, key, value)
  }

  if (entries.some(([key]) => runtimeSettingKeySet.has(key))) {
    await initializeRuntimeSettings()
  }

  if (entries.some(([key]) => analyticsSettingKeySet.has(key))) {
    await initializeAnalyticsSettings()
  }

  if (entries.some(([key]) => securitySettingKeySet.has(key))) {
    await initializeSecuritySettings()
  }
}

async function upsertAppSetting(db: Awaited<ReturnType<typeof useDb>>, key: string, value: unknown): Promise<void> {
  const updated = await queryDb(
    db,
    `UPDATE app_settings SET
      value = $value,
      updated_at = time::now()
    WHERE key = $key;`,
    { key, value }
  )

  if (queryRows(updated).length) {
    return
  }

  await queryDb(
    db,
    `UPSERT type::record($table, $id) CONTENT {
      key: $key,
      value: $value,
      updated_at: time::now()
    };`,
    { table: APP_SETTINGS_TABLE, id: key, key, value }
  )
}

export function filterPublicSettings(values: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => publicSettingKeySet.has(key))
  )
}

export function filterAdminSettings(values: Record<string, unknown>) {
  const allowed = new Set<string>(ADMIN_SETTING_KEYS)
  let filtered = Object.fromEntries(
    Object.entries(values).filter(([key]) => allowed.has(key))
  )

  if (ADMIN_COLOR_MODE_KEY in filtered) {
    const colorMode = normalizeAdminColorMode(filtered[ADMIN_COLOR_MODE_KEY])
    if (colorMode) {
      filtered[ADMIN_COLOR_MODE_KEY] = colorMode
    } else {
      return Object.fromEntries(
        Object.entries(filtered).filter(([key]) => key !== ADMIN_COLOR_MODE_KEY)
      )
    }
  }

  if (ADMIN_LOCALE_KEY in filtered) {
    const locale = normalizeAdminLocale(filtered[ADMIN_LOCALE_KEY])
    if (locale) {
      filtered[ADMIN_LOCALE_KEY] = locale
    } else {
      return Object.fromEntries(
        Object.entries(filtered).filter(([key]) => key !== ADMIN_LOCALE_KEY)
      )
    }
  }

  if (ADMIN_DATE_FORMAT_KEY in filtered) {
    const dateFormat = normalizeAdminDateFormat(filtered[ADMIN_DATE_FORMAT_KEY])
    if (dateFormat) {
      filtered[ADMIN_DATE_FORMAT_KEY] = dateFormat
    } else {
      filtered = withoutSetting(filtered, ADMIN_DATE_FORMAT_KEY)
    }
  }

  if (ADMIN_TIMEZONE_KEY in filtered) {
    const timezone = normalizeAdminTimezone(filtered[ADMIN_TIMEZONE_KEY])
    if (timezone) {
      filtered[ADMIN_TIMEZONE_KEY] = timezone
    } else {
      filtered = withoutSetting(filtered, ADMIN_TIMEZONE_KEY)
    }
  }

  if (ADMIN_FORMAT_LOCALE_KEY in filtered) {
    const locale = normalizeAdminFormatLocale(filtered[ADMIN_FORMAT_LOCALE_KEY])
    if (locale) {
      filtered[ADMIN_FORMAT_LOCALE_KEY] = locale
    } else {
      filtered = withoutSetting(filtered, ADMIN_FORMAT_LOCALE_KEY)
    }
  }

  if (ADMIN_POST_DISPLAY_MODE_KEY in filtered) {
    filtered[ADMIN_POST_DISPLAY_MODE_KEY] = normalizeAdminPostDisplayMode(filtered[ADMIN_POST_DISPLAY_MODE_KEY])
  }

  for (const key of ['graph_view_enabled', 'publish_heatmap_enabled'] as const) {
    if (key in filtered) {
      filtered[key] = booleanValue(filtered[key], true)
    }
  }

  if ('analytics_enabled' in filtered) {
    filtered.analytics_enabled = booleanValue(filtered.analytics_enabled, DEFAULT_ANALYTICS_SETTINGS.analytics_enabled)
  }

  if ('analytics_session_window_minutes' in filtered) {
    filtered.analytics_session_window_minutes = integerValue(
      filtered.analytics_session_window_minutes,
      DEFAULT_ANALYTICS_SETTINGS.analytics_session_window_minutes,
      5,
      24 * 60
    )
  }

  if ('analytics_retention_days' in filtered) {
    filtered.analytics_retention_days = integerValue(
      filtered.analytics_retention_days,
      DEFAULT_ANALYTICS_SETTINGS.analytics_retention_days,
      7,
      3650
    )
  }

  if ('security_alerts_enabled' in filtered) {
    filtered.security_alerts_enabled = booleanValue(filtered.security_alerts_enabled, DEFAULT_SECURITY_SETTINGS.security_alerts_enabled)
  }

  if ('security_alert_on_failed_login' in filtered) {
    filtered.security_alert_on_failed_login = booleanValue(filtered.security_alert_on_failed_login, DEFAULT_SECURITY_SETTINGS.security_alert_on_failed_login)
  }

  if ('security_alert_on_lockout' in filtered) {
    filtered.security_alert_on_lockout = booleanValue(filtered.security_alert_on_lockout, DEFAULT_SECURITY_SETTINGS.security_alert_on_lockout)
  }

  if ('security_alert_on_new_login' in filtered) {
    filtered.security_alert_on_new_login = booleanValue(filtered.security_alert_on_new_login, DEFAULT_SECURITY_SETTINGS.security_alert_on_new_login)
  }

  if ('security_mfa_required_for_admins' in filtered) {
    filtered.security_mfa_required_for_admins = booleanValue(filtered.security_mfa_required_for_admins, DEFAULT_SECURITY_SETTINGS.security_mfa_required_for_admins)
  }

  if ('security_alert_webhook_url' in filtered) {
    const url = normalizeWebhookUrl(filtered.security_alert_webhook_url)
    if (url === null) {
      filtered = withoutSetting(filtered, 'security_alert_webhook_url')
    } else {
      filtered.security_alert_webhook_url = url
    }
  }

  return filtered
}

function withoutSetting(values: Record<string, unknown>, settingKey: string) {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => key !== settingKey)
  )
}

export function getRuntimeFlags(): RuntimeFlags {
  return runtimeFlagsCache
}

export async function initializeRuntimeSettings(seedDefaults = false): Promise<RuntimeFlags> {
  const settings = await readRawAppSettings(RUNTIME_SETTING_KEYS)

  if (seedDefaults) {
    const missingEntries = Object.entries(DEFAULT_RUNTIME_FLAGS).filter(([key]) => !(key in settings))
    if (missingEntries.length) {
      const db = await useDb()
      for (const [key, value] of missingEntries) {
        await upsertAppSetting(db, key, value)
        settings[key] = value
      }
    }
  }

  runtimeFlagsCache = normalizeRuntimeFlags(settings)
  return runtimeFlagsCache
}

export function getAnalyticsSettings(): AnalyticsSettings {
  return analyticsSettingsCache
}

export async function initializeAnalyticsSettings(seedDefaults = false): Promise<AnalyticsSettings> {
  const settings = await readRawAppSettings(ANALYTICS_SETTING_KEYS)

  if (seedDefaults) {
    const missingEntries = Object.entries(DEFAULT_ANALYTICS_SETTINGS).filter(([key]) => !(key in settings))
    if (missingEntries.length) {
      const db = await useDb()
      for (const [key, value] of missingEntries) {
        await upsertAppSetting(db, key, value)
        settings[key] = value
      }
    }
  }

  analyticsSettingsCache = normalizeAnalyticsSettings(settings)
  return analyticsSettingsCache
}

export function getSecuritySettings(): SecuritySettings {
  return securitySettingsCache
}

export async function initializeSecuritySettings(seedDefaults = false): Promise<SecuritySettings> {
  const settings = await readRawAppSettings(SECURITY_SETTING_KEYS)

  if (seedDefaults) {
    const missingEntries = Object.entries(DEFAULT_SECURITY_SETTINGS).filter(([key]) => !(key in settings))
    if (missingEntries.length) {
      const db = await useDb()
      for (const [key, value] of missingEntries) {
        await upsertAppSetting(db, key, value)
        settings[key] = value
      }
    }
  }

  securitySettingsCache = normalizeSecuritySettings(settings)
  return securitySettingsCache
}

let analyticsSaltFlight: Promise<string> | undefined
export function getAnalyticsHashSalt(): Promise<string> {
  // Share initialization, not a forever authorization/configuration cache.
  analyticsSaltFlight ??= (async () => {
    const db = await useDb()
    const existing = queryRows<{value: unknown}>(await queryDb(db, 'SELECT `value` FROM app_settings WHERE key = $key LIMIT 1;', {key: ANALYTICS_HASH_SALT_KEY}, {retry: 'readOnly'}))[0]?.value
    if (typeof existing === 'string' && existing.length >= 32 && existing.length <= 256) return existing
    const row = queryRows<{value: unknown}>(await queryDb(db, `UPSERT type::record('app_settings', $key) SET key = $key,
      value = IF type::is_string(value) AND string::len(value) >= 32 THEN value ELSE $salt END,
      updated_at = time::now() RETURN AFTER;`, {key: ANALYTICS_HASH_SALT_KEY, salt: randomBytes(32).toString('hex')}, {retry: 'never', label: 'atomic analytics salt'}))[0]
    if (typeof row?.value !== 'string' || row.value.length < 32 || row.value.length > 256) throw new Error('Invalid analytics hash salt')
    return row.value
  })().finally(() => {analyticsSaltFlight = undefined})
  return analyticsSaltFlight
}

export async function isSetupCompleted(): Promise<boolean> {
  const db = await useDb()
  const marker = await queryDb(db, 'SELECT `value` FROM app_settings WHERE key = $key LIMIT 1;', {key: SETUP_COMPLETED_KEY}, {retryOnReconnect: false, label: 'setup state'})
  return queryRows<{value?: unknown}>(marker)[0]?.value === true
}

function normalizeRuntimeFlags(_values: Record<string, unknown>): RuntimeFlags {
  // Trusting reverse-proxy headers is always required: the app is designed to
  // run behind an HTTPS reverse proxy that sets X-Forwarded-For, so this is
  // pinned on and is no longer operator-configurable.
  return {
    trust_proxy_headers: true
  }
}

function normalizeAnalyticsSettings(values: Record<string, unknown>): AnalyticsSettings {
  return {
    analytics_enabled: booleanValue(values.analytics_enabled, DEFAULT_ANALYTICS_SETTINGS.analytics_enabled),
    analytics_session_window_minutes: integerValue(
      values.analytics_session_window_minutes,
      DEFAULT_ANALYTICS_SETTINGS.analytics_session_window_minutes,
      5,
      24 * 60
    ),
    analytics_retention_days: integerValue(
      values.analytics_retention_days,
      DEFAULT_ANALYTICS_SETTINGS.analytics_retention_days,
      7,
      3650
    )
  }
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeSecuritySettings(values: Record<string, unknown>): SecuritySettings {
  return {
    security_alerts_enabled: booleanValue(values.security_alerts_enabled, DEFAULT_SECURITY_SETTINGS.security_alerts_enabled),
    security_alert_webhook_url: normalizeWebhookUrl(values.security_alert_webhook_url) ?? DEFAULT_SECURITY_SETTINGS.security_alert_webhook_url,
    security_alert_on_failed_login: booleanValue(values.security_alert_on_failed_login, DEFAULT_SECURITY_SETTINGS.security_alert_on_failed_login),
    security_alert_on_lockout: booleanValue(values.security_alert_on_lockout, DEFAULT_SECURITY_SETTINGS.security_alert_on_lockout),
    security_alert_on_new_login: booleanValue(values.security_alert_on_new_login, DEFAULT_SECURITY_SETTINGS.security_alert_on_new_login),
    security_mfa_required_for_admins: booleanValue(values.security_mfa_required_for_admins, DEFAULT_SECURITY_SETTINGS.security_mfa_required_for_admins)
  }
}

/**
 * Returns a normalized http(s) webhook URL, an empty string when cleared, or
 * `null` when the value is invalid (so the caller can reject the update).
 */
function normalizeWebhookUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return null
  }
  return parsed.toString()
}

function normalizeAdminColorMode(value: unknown): ThemeModeSetting | null {
  return normalizeThemeMode(value)
}

export function normalizePublicSettings(values: Record<string, unknown>): PublicSiteSettings {
  return {
    site_title: stringValue(values.site_title),
    site_subtitle: stringValue(values.site_subtitle),
    site_logo: stringValue(values.site_logo),
    site_banner: stringValue(values.site_banner),
    site_banner_position_x: numberValue(values.site_banner_position_x, 50, 0, 100),
    site_banner_position_y: numberValue(values.site_banner_position_y, 50, 0, 100),
    site_banner_zoom: numberValue(values.site_banner_zoom, 100, 100, 200),
    site_hero_height_vh: numberValue(values.site_hero_height_vh, 34, 18, 58),
    site_favicon: stringValue(values.site_favicon),
    owner_name: stringValue(values.owner_name),
    owner_avatar: stringValue(values.owner_avatar),
    owner_motto: stringValue(values.owner_motto),
    owner_bio: jsonContentValue(values.owner_bio),
    owner_bio_visible: booleanValue(values.owner_bio_visible, true),
    footer_copyright: stringValue(values.footer_copyright),
    footer_links: linksValue(values.footer_links),
    footer_social: linksValue(values.footer_social),
    footer_filings: linksValue(values.footer_filings),
    footer_show_powered_by: booleanValue(values.footer_show_powered_by, true),
    graph_view_enabled: booleanValue(values.graph_view_enabled, true),
    publish_heatmap_enabled: booleanValue(values.publish_heatmap_enabled, true)
  }
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function numberValue(value: unknown, fallback: number, min: number, max: number) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) {
    return fallback
  }

  return Math.min(max, Math.max(min, number))
}

function integerValue(value: unknown, fallback: number, min: number, max: number) {
  return Math.round(numberValue(value, fallback, min, max))
}

function jsonContentValue(value: unknown): JsonContent | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const node = value as JsonContent
  return typeof node.type === 'string' ? node : null
}

function linksValue(value: unknown): SettingsLink[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null
      }

      const link = item as Record<string, unknown>
      const label = stringValue(link.label).trim()
      const url = safeUrl(stringValue(link.url).trim())
      const icon = stringValue(link.icon).trim()

      if (!label || !url) {
        return null
      }

      return icon ? { label, url, icon } : { label, url }
    })
    .filter((item): item is SettingsLink => Boolean(item))
}

function safeUrl(value: string) {
  if (
    value.startsWith('/') ||
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('mailto:') ||
    value.startsWith('tel:')
  ) {
    return value
  }

  return ''
}

// ============ MEDIA SETTINGS ============

export interface MediaSettings {
  allowed_extensions: string[]
  max_file_size_mb: number
  oversized_image_threshold_mb: number
  max_files_per_upload: number
  enable_perceptual_dedup: boolean
  perceptual_dedup_threshold: number
  download_cleanup_hours: number
  public_base_url: string
  local_only: boolean
  prevent_hotlinking: boolean
  orphan_cleanup_enabled: boolean
  orphan_cleanup_days: number
  orphan_cleanup_cron: string
}

const DEFAULT_MEDIA_SETTINGS: MediaSettings = {
  allowed_extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md', 'mp4', 'webm', 'mov', 'zip', 'rar', '7z'],
  max_file_size_mb: 10,
  oversized_image_threshold_mb: 0,
  max_files_per_upload: 5,
  enable_perceptual_dedup: false,
  perceptual_dedup_threshold: 5,
  download_cleanup_hours: 1,
  public_base_url: '',
  local_only: false,
  prevent_hotlinking: false,
  orphan_cleanup_enabled: false,
  orphan_cleanup_days: 30,
  orphan_cleanup_cron: '0 4 * * *'
}

export async function getMediaSettings(): Promise<MediaSettings> {
  const db = await useDb()
  const response = await queryDb(db, 'SELECT * FROM app_settings WHERE key = $key LIMIT 1;', { key: 'media' })
  const rows = queryRows<Record<string, unknown>>(response)
  
  if (!rows || !rows.length) {
    return DEFAULT_MEDIA_SETTINGS
  }

  const row = rows[0]
  if (!row || !row.value || typeof row.value !== 'object') {
    return DEFAULT_MEDIA_SETTINGS
  }

  const settings = row.value as Record<string, unknown>
  return {
    allowed_extensions: Array.isArray(settings.allowed_extensions) ? settings.allowed_extensions as string[] : DEFAULT_MEDIA_SETTINGS.allowed_extensions,
    max_file_size_mb: typeof settings.max_file_size_mb === 'number' ? settings.max_file_size_mb : DEFAULT_MEDIA_SETTINGS.max_file_size_mb,
    oversized_image_threshold_mb: typeof settings.oversized_image_threshold_mb === 'number' && settings.oversized_image_threshold_mb >= 0 ? settings.oversized_image_threshold_mb : DEFAULT_MEDIA_SETTINGS.oversized_image_threshold_mb,
    max_files_per_upload: typeof settings.max_files_per_upload === 'number' ? settings.max_files_per_upload : DEFAULT_MEDIA_SETTINGS.max_files_per_upload,
    enable_perceptual_dedup: typeof settings.enable_perceptual_dedup === 'boolean' ? settings.enable_perceptual_dedup : DEFAULT_MEDIA_SETTINGS.enable_perceptual_dedup,
    perceptual_dedup_threshold: typeof settings.perceptual_dedup_threshold === 'number' ? settings.perceptual_dedup_threshold : DEFAULT_MEDIA_SETTINGS.perceptual_dedup_threshold,
    download_cleanup_hours: typeof settings.download_cleanup_hours === 'number' ? settings.download_cleanup_hours : DEFAULT_MEDIA_SETTINGS.download_cleanup_hours,
    public_base_url: stringValue(settings.public_base_url).replace(/\/+$/, ''),
    local_only: settings.local_only === true,
    prevent_hotlinking: settings.prevent_hotlinking === true,
    orphan_cleanup_enabled: settings.orphan_cleanup_enabled === true,
    orphan_cleanup_days: typeof settings.orphan_cleanup_days === 'number' ? settings.orphan_cleanup_days : DEFAULT_MEDIA_SETTINGS.orphan_cleanup_days,
    orphan_cleanup_cron: stringValue(settings.orphan_cleanup_cron) || DEFAULT_MEDIA_SETTINGS.orphan_cleanup_cron
  }
}

export async function updateMediaSettings(settings: MediaSettings): Promise<void> {
  const db = await useDb()
  // Remove any legacy record with a different ID that holds key='media' (fixes unique index conflict)
  await queryDb(db, `DELETE FROM app_settings WHERE key = $key AND id != type::record($table, $id);`, {
    table: APP_SETTINGS_TABLE, id: 'media', key: 'media'
  })
  await queryDb(
    db,
    `UPSERT type::record($table, $id) CONTENT {
      key: $key,
      value: $value,
      updated_at: time::now()
    };`,
    { table: APP_SETTINGS_TABLE, id: 'media', key: 'media', value: settings }
  )
}

// ============ POST VERSIONING SETTINGS ============

export interface PostVersioningSettings {
  snapshot_limit: number
}

export const DEFAULT_POST_VERSIONING_SETTINGS: PostVersioningSettings = {
  snapshot_limit: 20
}

export async function getPostVersioningSettings(): Promise<PostVersioningSettings> {
  const db = await useDb()
  const response = await queryDb(db, 'SELECT * FROM app_settings WHERE key = $key LIMIT 1;', { key: 'post_versioning' })
  const row = queryRows<Record<string, unknown>>(response)[0]
  const value = row?.value && typeof row.value === 'object' ? row.value as Record<string, unknown> : {}
  return normalizePostVersioningSettings(value)
}

export async function updatePostVersioningSettings(settings: PostVersioningSettings): Promise<void> {
  const db = await useDb()
  const normalized = normalizePostVersioningSettings(settings as unknown as Record<string, unknown>)
  await queryDb(db, `DELETE FROM app_settings WHERE key = $key AND id != type::record($table, $id);`, {
    table: APP_SETTINGS_TABLE, id: 'post_versioning', key: 'post_versioning'
  })
  await queryDb(
    db,
    `UPSERT type::record($table, $id) CONTENT {
      key: $key,
      value: $value,
      updated_at: time::now()
    };`,
    { table: APP_SETTINGS_TABLE, id: 'post_versioning', key: 'post_versioning', value: normalized }
  )
}

function normalizePostVersioningSettings(value: Record<string, unknown>): PostVersioningSettings {
  const limit = Number(value.snapshot_limit ?? DEFAULT_POST_VERSIONING_SETTINGS.snapshot_limit)
  return {
    snapshot_limit: Number.isFinite(limit) ? Math.max(1, Math.min(200, Math.floor(limit))) : DEFAULT_POST_VERSIONING_SETTINGS.snapshot_limit
  }
}

// ---------------------------------------------------------------------------
// Backup & restore settings
// ---------------------------------------------------------------------------

export interface BackupSettings {
  /** Maximum READY full snapshots; legacy evidence suspends pruning. 0 = unlimited. */
  max_backups: number
  /** Validate a dump in a throwaway staging DB before importing it. */
  validate_before_restore: boolean
  /** Take an automatic safety snapshot before a restore so it can be rolled back. */
  auto_safety_snapshot: boolean
}

const DEFAULT_BACKUP_SETTINGS: BackupSettings = {
  max_backups: 10,
  validate_before_restore: true,
  auto_safety_snapshot: true
}

export async function getBackupSettings(): Promise<BackupSettings> {
  const db = await useDb()
  const response = await queryDb(db, 'SELECT * FROM app_settings WHERE key = $key LIMIT 1;', { key: 'backups' })
  const rows = queryRows<Record<string, unknown>>(response)

  if (!rows || !rows.length) {
    return { ...DEFAULT_BACKUP_SETTINGS }
  }

  const row = rows[0]
  if (!row || !row.value || typeof row.value !== 'object') {
    return { ...DEFAULT_BACKUP_SETTINGS }
  }

  const settings = row.value as Record<string, unknown>
  return {
    max_backups: numberValue(settings.max_backups, DEFAULT_BACKUP_SETTINGS.max_backups, 0, 1000),
    validate_before_restore: typeof settings.validate_before_restore === 'boolean'
      ? settings.validate_before_restore
      : DEFAULT_BACKUP_SETTINGS.validate_before_restore,
    auto_safety_snapshot: typeof settings.auto_safety_snapshot === 'boolean'
      ? settings.auto_safety_snapshot
      : DEFAULT_BACKUP_SETTINGS.auto_safety_snapshot
  }
}

export async function updateBackupSettings(settings: BackupSettings): Promise<void> {
  const db = await useDb()
  await queryDb(db, `DELETE FROM app_settings WHERE key = $key AND id != type::record($table, $id);`, {
    table: APP_SETTINGS_TABLE, id: 'backups', key: 'backups'
  })
  await queryDb(
    db,
    `UPSERT type::record($table, $id) CONTENT {
      key: $key,
      value: $value,
      updated_at: time::now()
    };`,
    { table: APP_SETTINGS_TABLE, id: 'backups', key: 'backups', value: settings }
  )
}
