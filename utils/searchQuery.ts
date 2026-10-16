/**
 * Shared (client + server) model for the public advanced search.
 *
 * URL / API parameters:
 *   q       plain search-bar text (one keyword; words must all appear in the same block)
 *   kw      keyword groups, `op:term,term;op:term` (e.g. `or:github,gitlab;or:actions,ci`)
 *   kwop    operator between keyword groups (`and` | `or`)
 *   cat     category slugs (comma separated, sub-categories are included server-side)
 *   tag     tag slugs (comma separated, OR)
 *   author  opaque author ids (comma separated, OR)
 *   date    date preset (`7d` | `30d` | `12m` | `year` | `custom`)
 *   start   custom range start (YYYY-MM-DD, inclusive)
 *   end     custom range end (YYYY-MM-DD, inclusive)
 *   tz      browser timezone offset in minutes (Date#getTimezoneOffset)
 *
 * The plain `q` and the keyword expression are combined with AND, and every
 * filter narrows the result further (AND). Kept free of `~` imports so the
 * server and unit tests can load it directly.
 */

export type SearchKeywordOperator = 'and' | 'or'

export interface SearchKeywordGroup {
  op: SearchKeywordOperator
  terms: string[]
}

export type SearchDatePreset = '7d' | '30d' | '12m' | 'year' | 'custom'

export interface AdvancedSearchCriteria {
  q: string
  groups: SearchKeywordGroup[]
  groupOp: SearchKeywordOperator
  categories: string[]
  tags: string[]
  date: SearchDatePreset | ''
  start: string
  end: string
  tz: number | null
}

export const SEARCH_LIMITS = {
  maxQueryLength: 200,
  maxGroups: 5,
  maxTermsPerGroup: 5,
  maxTermLength: 64,
  maxCategories: 10,
  maxTags: 20
} as const

export const SEARCH_DATE_PRESETS: readonly SearchDatePreset[] = ['7d', '30d', '12m', 'year', 'custom']

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/
/** Comma separators accepted in keyword inputs (ASCII, full-width, ideographic enumeration). */
const TERM_SEPARATOR_REGEX = /[,，、]/

export function createEmptySearchCriteria(): AdvancedSearchCriteria {
  return {
    q: '',
    groups: [],
    groupOp: 'and',
    categories: [],
    tags: [],
    date: '',
    start: '',
    end: '',
    tz: null
  }
}

/** Split a comma-separated keyword input into trimmed, de-duplicated terms. */
export function splitSearchTerms(input: string): string[] {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const raw of String(input ?? '').split(TERM_SEPARATOR_REGEX)) {
    const term = raw.replace(/[;\s]+/g, ' ').trim().slice(0, SEARCH_LIMITS.maxTermLength).trim()
    const key = term.toLowerCase()
    if (!term || seen.has(key)) continue
    seen.add(key)
    terms.push(term)
    if (terms.length >= SEARCH_LIMITS.maxTermsPerGroup) break
  }
  return terms
}

export function normalizeSearchOperator(value: unknown, fallback: SearchKeywordOperator = 'and'): SearchKeywordOperator {
  if (value === 'and' || value === 'or') return value
  return fallback
}

/** Parse `op:term,term;op:term` into keyword groups. Unknown/empty parts are dropped. */
export function parseSearchKeywordGroups(raw: unknown): SearchKeywordGroup[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  const groups: SearchKeywordGroup[] = []
  for (const part of raw.split(';')) {
    const match = /^\s*(and|or)\s*:(.*)$/is.exec(part)
    const op = match ? normalizeSearchOperator(match[1]!.toLowerCase(), 'or') : 'or'
    const terms = splitSearchTerms(match ? match[2]! : part)
    if (!terms.length) continue
    groups.push({ op, terms })
    if (groups.length >= SEARCH_LIMITS.maxGroups) break
  }
  return groups
}

export function serializeSearchKeywordGroups(groups: SearchKeywordGroup[]): string {
  return groups
    .map((group) => ({ op: group.op, terms: group.terms.map((term) => term.trim()).filter(Boolean) }))
    .filter((group) => group.terms.length)
    .slice(0, SEARCH_LIMITS.maxGroups)
    .map((group) => `${group.op}:${group.terms.join(',')}`)
    .join(';')
}

function splitList(value: unknown, max: number): string[] {
  const raw = Array.isArray(value) ? value.join(',') : typeof value === 'string' ? value : ''
  const seen = new Set<string>()
  const items: string[] = []
  for (const part of raw.split(',')) {
    const item = part.trim().slice(0, 200)
    if (!item || seen.has(item)) continue
    seen.add(item)
    items.push(item)
    if (items.length >= max) break
  }
  return items
}

function firstString(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

export function normalizeSearchDatePreset(value: unknown): SearchDatePreset | '' {
  return SEARCH_DATE_PRESETS.includes(value as SearchDatePreset) ? value as SearchDatePreset : ''
}

function normalizeDateOnly(value: unknown): string {
  const text = firstString(value).trim()
  if (!DATE_ONLY_REGEX.test(text)) return ''
  const date = new Date(`${text}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? '' : text
}

function normalizeTimezoneOffset(value: unknown): number | null {
  const text = firstString(value).trim()
  if (!text) return null
  const offset = Number(text)
  if (!Number.isFinite(offset) || Math.abs(offset) > 14 * 60) return null
  return Math.trunc(offset)
}

/** Read criteria from a route / API query object. */
export function parseSearchCriteria(query: Record<string, unknown>): AdvancedSearchCriteria {
  return {
    q: firstString(query.q).trim().slice(0, SEARCH_LIMITS.maxQueryLength),
    groups: parseSearchKeywordGroups(firstString(query.kw)),
    groupOp: normalizeSearchOperator(firstString(query.kwop), 'and'),
    categories: splitList(query.cat, SEARCH_LIMITS.maxCategories),
    tags: splitList(query.tag, SEARCH_LIMITS.maxTags),
    date: normalizeSearchDatePreset(firstString(query.date)),
    start: normalizeDateOnly(query.start),
    end: normalizeDateOnly(query.end),
    tz: normalizeTimezoneOffset(query.tz)
  }
}

/** Serialize criteria to route / API query params (empty values are omitted). */
export function buildSearchCriteriaQuery(criteria: AdvancedSearchCriteria): Record<string, string> {
  const query: Record<string, string> = {}
  const q = criteria.q.trim()
  if (q) query.q = q
  const kw = serializeSearchKeywordGroups(criteria.groups)
  if (kw) {
    query.kw = kw
    if (criteria.groupOp === 'or') query.kwop = 'or'
  }
  if (criteria.categories.length) query.cat = criteria.categories.join(',')
  if (criteria.tags.length) query.tag = criteria.tags.join(',')
  if (criteria.date) {
    query.date = criteria.date
    if (criteria.date === 'custom') {
      if (criteria.start) query.start = criteria.start
      if (criteria.end) query.end = criteria.end
    }
    if (criteria.tz !== null) query.tz = String(criteria.tz)
  }
  return query
}

export function hasSearchKeywords(criteria: AdvancedSearchCriteria): boolean {
  return Boolean(criteria.q.trim()) || criteria.groups.some((group) => group.terms.length > 0)
}

export function hasSearchFilters(criteria: AdvancedSearchCriteria): boolean {
  return criteria.categories.length > 0
    || criteria.tags.length > 0
    || hasSearchDateRange(criteria)
}

export function hasSearchDateRange(criteria: AdvancedSearchCriteria): boolean {
  if (!criteria.date) return false
  if (criteria.date === 'custom') return Boolean(criteria.start || criteria.end)
  return true
}

/** True when the advanced panel carries anything beyond the plain `q`. */
export function hasAdvancedSearchCriteria(criteria: AdvancedSearchCriteria): boolean {
  return criteria.groups.some((group) => group.terms.length > 0) || hasSearchFilters(criteria)
}

export function hasAnySearchCriteria(criteria: AdvancedSearchCriteria): boolean {
  return hasSearchKeywords(criteria) || hasSearchFilters(criteria)
}

/**
 * Resolve the date filter to absolute instants. Presets are relative to `now`;
 * custom dates are whole local days in the browser timezone given by `tz`
 * (minutes, same sign as Date#getTimezoneOffset), falling back to UTC.
 */
export function resolveSearchDateRange(
  criteria: Pick<AdvancedSearchCriteria, 'date' | 'start' | 'end' | 'tz'>,
  now: Date = new Date()
): { from: Date | null, to: Date | null } {
  const tz = criteria.tz ?? 0
  const dayMs = 24 * 60 * 60 * 1000
  switch (criteria.date) {
    case '7d':
      return { from: new Date(now.getTime() - 7 * dayMs), to: null }
    case '30d':
      return { from: new Date(now.getTime() - 30 * dayMs), to: null }
    case '12m': {
      const from = new Date(now.getTime())
      from.setUTCFullYear(from.getUTCFullYear() - 1)
      return { from, to: null }
    }
    case 'year': {
      // Local calendar year of `now` in the requested timezone.
      const localNow = new Date(now.getTime() - tz * 60_000)
      const localYearStart = Date.UTC(localNow.getUTCFullYear(), 0, 1)
      return { from: new Date(localYearStart + tz * 60_000), to: null }
    }
    case 'custom': {
      const from = criteria.start ? new Date(Date.parse(`${criteria.start}T00:00:00.000Z`) + tz * 60_000) : null
      const to = criteria.end ? new Date(Date.parse(`${criteria.end}T00:00:00.000Z`) + dayMs - 1 + tz * 60_000) : null
      if (from && to && from.getTime() > to.getTime()) {
        return { from: to, to: from }
      }
      return { from, to }
    }
    default:
      return { from: null, to: null }
  }
}

/**
 * Evaluate the keyword expression (`q` AND (group op group ...)) for one
 * post. `matches(termKey)` reports whether the term with that key matched.
 * Term keys are produced by {@link collectSearchTerms}.
 */
export function evaluateSearchExpression(
  criteria: Pick<AdvancedSearchCriteria, 'q' | 'groups' | 'groupOp'>,
  matches: (termKey: string) => boolean
): boolean {
  const q = criteria.q.trim()
  if (q && !matches(searchTermKey(q))) return false

  const groups = criteria.groups.filter((group) => group.terms.length > 0)
  if (!groups.length) return Boolean(q)

  const groupResult = (group: SearchKeywordGroup) => group.op === 'and'
    ? group.terms.every((term) => matches(searchTermKey(term)))
    : group.terms.some((term) => matches(searchTermKey(term)))

  return criteria.groupOp === 'or' ? groups.some(groupResult) : groups.every(groupResult)
}

/**
 * Human-readable keyword expression, e.g. `docker AND (github OR gitlab)`.
 * Used in result summaries; operators are kept in English on purpose (they
 * mirror the query syntax, not UI copy).
 */
export function describeSearchKeywords(criteria: Pick<AdvancedSearchCriteria, 'q' | 'groups' | 'groupOp'>): string {
  const parts: string[] = []
  const q = criteria.q.trim()
  if (q) parts.push(q)
  const groups = criteria.groups.filter((group) => group.terms.length > 0)
  const quote = (term: string) => /\s/.test(term) ? `"${term}"` : term
  const groupTexts = groups.map((group) => {
    const text = group.terms.map(quote).join(group.op === 'and' ? ' AND ' : ' OR ')
    return group.terms.length > 1 && (groups.length > 1 || q) ? `(${text})` : text
  })
  if (groupTexts.length) {
    const joined = groupTexts.join(criteria.groupOp === 'or' ? ' OR ' : ' AND ')
    parts.push(groupTexts.length > 1 && q && criteria.groupOp === 'or' ? `(${joined})` : joined)
  }
  return parts.join(' AND ')
}

/** Stable key for a term; identical terms (case-insensitive) share one lookup. */
export function searchTermKey(term: string): string {
  return term.trim().replace(/\s+/g, ' ').toLowerCase()
}

export interface CollectedSearchTerm {
  key: string
  text: string
  /** Multi-word keywords typed in the advanced panel must match as a phrase. */
  phrase: boolean
}

/** Distinct terms referenced by the criteria (plain `q` first). */
export function collectSearchTerms(criteria: Pick<AdvancedSearchCriteria, 'q' | 'groups'>): CollectedSearchTerm[] {
  const byKey = new Map<string, CollectedSearchTerm>()
  const q = criteria.q.trim()
  if (q) byKey.set(searchTermKey(q), { key: searchTermKey(q), text: q, phrase: false })
  for (const group of criteria.groups) {
    for (const term of group.terms) {
      const key = searchTermKey(term)
      if (!key || byKey.has(key)) continue
      byKey.set(key, { key, text: term.trim(), phrase: /\s/.test(term.trim()) })
    }
  }
  return [...byKey.values()]
}
