/**
 * Browser-local state for the admin Posts table. The sort and every column
 * filter survive route changes and reloads; the defaults are published/desc.
 */
import type { PostStatus, PostVisibility } from '~/types/content'

export type AdminPostSortKey =
  | 'updated'
  | 'published'
  | 'title'
  | 'status'
  | 'visibility'
  | 'length'
export type AdminPostSortDir = 'asc' | 'desc'
export type AdminPostPerPage = '10' | '25' | '50' | '100'

export interface AdminPostListPrefs {
  titleQuery: string
  tagSearch: string
  categorySearch: string
  selectedStatuses: PostStatus[]
  selectedVisibilities: PostVisibility[]
  selectedTagIds: string[]
  selectedCategoryIds: string[]
  lengthMin: string
  lengthMax: string
  publishedFrom: string
  publishedTo: string
  updatedFrom: string
  updatedTo: string
  sortKey: AdminPostSortKey
  sortDir: AdminPostSortDir
  perPage: AdminPostPerPage
}

export const ADMIN_POST_LIST_PREFS_STORAGE_KEY = 'pb-admin-posts-list-prefs'
export const ADMIN_POST_DEFAULT_SORT_KEY: AdminPostSortKey = 'published'
export const ADMIN_POST_DEFAULT_SORT_DIR: AdminPostSortDir = 'desc'

const POST_STATUSES: readonly PostStatus[] = ['draft', 'published', 'archived']
const POST_VISIBILITIES: readonly PostVisibility[] = ['public', 'private', 'password']
const SORT_KEYS: readonly AdminPostSortKey[] = [
  'updated',
  'published',
  'title',
  'status',
  'visibility',
  'length'
]
const SORT_DIRS: readonly AdminPostSortDir[] = ['asc', 'desc']
const PER_PAGE_OPTIONS: readonly AdminPostPerPage[] = ['10', '25', '50', '100']

export function createDefaultAdminPostListPrefs(): AdminPostListPrefs {
  return {
    titleQuery: '',
    tagSearch: '',
    categorySearch: '',
    selectedStatuses: [],
    selectedVisibilities: [],
    selectedTagIds: [],
    selectedCategoryIds: [],
    lengthMin: '',
    lengthMax: '',
    publishedFrom: '',
    publishedTo: '',
    updatedFrom: '',
    updatedTo: '',
    sortKey: ADMIN_POST_DEFAULT_SORT_KEY,
    sortDir: ADMIN_POST_DEFAULT_SORT_DIR,
    perPage: '10'
  }
}

export function normalizeAdminPostListPrefs(value: unknown): AdminPostListPrefs {
  const input = isRecord(value) ? value : {}
  const defaults = createDefaultAdminPostListPrefs()

  return {
    titleQuery: normalizeText(input.titleQuery),
    tagSearch: normalizeText(input.tagSearch),
    categorySearch: normalizeText(input.categorySearch),
    selectedStatuses: normalizeEnumArray(input.selectedStatuses, POST_STATUSES),
    selectedVisibilities: normalizeEnumArray(input.selectedVisibilities, POST_VISIBILITIES),
    selectedTagIds: normalizeStringArray(input.selectedTagIds),
    selectedCategoryIds: normalizeStringArray(input.selectedCategoryIds),
    lengthMin: normalizeCountInput(input.lengthMin),
    lengthMax: normalizeCountInput(input.lengthMax),
    publishedFrom: normalizeDateInput(input.publishedFrom),
    publishedTo: normalizeDateInput(input.publishedTo),
    updatedFrom: normalizeDateInput(input.updatedFrom),
    updatedTo: normalizeDateInput(input.updatedTo),
    sortKey: isOneOf(input.sortKey, SORT_KEYS) ? input.sortKey : defaults.sortKey,
    sortDir: isOneOf(input.sortDir, SORT_DIRS) ? input.sortDir : defaults.sortDir,
    perPage: isOneOf(input.perPage, PER_PAGE_OPTIONS) ? input.perPage : defaults.perPage
  }
}

export function parseAdminPostListPrefs(raw: string | null): AdminPostListPrefs {
  if (!raw) {
    return createDefaultAdminPostListPrefs()
  }

  try {
    return normalizeAdminPostListPrefs(JSON.parse(raw))
  } catch {
    return createDefaultAdminPostListPrefs()
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean)
    )
  )
}

function normalizeEnumArray<T extends string>(value: unknown, options: readonly T[]): T[] {
  if (!Array.isArray(value)) {
    return []
  }

  const allowed = new Set<string>(options)

  return Array.from(
    new Set(value.filter((entry): entry is T => typeof entry === 'string' && allowed.has(entry)))
  )
}

function normalizeCountInput(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return ''
  }

  const raw = String(value).trim()
  if (!raw) {
    return ''
  }

  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? String(Math.trunc(parsed)) : ''
}

function normalizeDateInput(value: unknown): string {
  const raw = normalizeText(value).trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return ''
  }

  const date = new Date(`${raw}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? '' : raw
}
