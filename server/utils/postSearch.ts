import type { Surreal } from 'surrealdb'
import { queryDb } from './db'
import { queryRows, stringifyRecordId } from './surrealResult'
import type { SessionUser } from './users'
import { expandFuzzyNeedles } from './searchTerms'
import { clampFtsNeedle, createPhraseMatcher, fuzzyPenalty } from './fuzzy'
import {
  collectSearchTerms,
  describeSearchKeywords,
  evaluateSearchExpression,
  hasSearchKeywords,
  resolveSearchDateRange,
  type AdvancedSearchCriteria
} from '../../utils/searchQuery'
import type {
  PostStatus,
  PostVisibility,
  SearchBlockMatch,
  SearchMatchTier,
  SearchPostResult,
  SearchResponse,
  SearchSort
} from '../../types/content'

/**
 * Public post search: keyword expression (exact full-text + typo-tolerant
 * fallback), taxonomy / date filters and session-aware access rules.
 *
 * Ranking: every post whose keyword expression is satisfied by exact matches
 * ranks above every post that needs a fuzzy (typo-corrected) match. Within a
 * tier the requested sort applies.
 */

export interface PostSearchViewer {
  user: SessionUser | null
  /** Posts unlocked with a password in this browser session. */
  unlockedIds: Set<string>
}

export interface PostSearchRequest {
  criteria: AdvancedSearchCriteria
  sort: SearchSort
  page: number
  limit: number
  maxPerPost: number
  viewer: PostSearchViewer
}

// Private-use sentinel characters used as highlight markers. They are not HTML
// special characters, so they survive escaping and are swapped for <mark> after.
export const HIGHLIGHT_OPEN = '\uE000'
export const HIGHLIGHT_CLOSE = '\uE001'

/** Hard cap on full-text needles (exact + fuzzy) per request. */
const MAX_NEEDLES = 40
/** Rows read per needle and table. */
const NEEDLE_ROW_LIMIT = 300
const TITLE_WEIGHT = 10
const SUMMARY_WEIGHT = 3
const BLOCK_WEIGHT = 1

const POST_FIELDS = 'id, slug, title, summary, cover_image, published_at, updated_at, status, visibility, view_count, word_count, cjk_char_count'

type MatchUnit = 'title' | 'summary' | 'block'

interface Needle {
  termKey: string
  text: string
  fuzzy: boolean
  distance: number
  phrase: ((text: string) => boolean) | null
}

interface Hit {
  unit: MatchUnit
  unitId: string
  type: string
  snippet: string
  score: number
  fuzzy: boolean
  distance: number
}

interface PostRow extends Record<string, unknown> {
  id: unknown
}

export async function runPostSearch(db: Surreal, request: PostSearchRequest): Promise<SearchResponse> {
  const { criteria, sort, page, limit, maxPerPost, viewer } = request
  const hasKeywords = hasSearchKeywords(criteria)
  const empty = (): SearchResponse => ({
    query: describeSearchKeywords(criteria),
    sort,
    limit,
    page,
    pages: 0,
    total: 0,
    maxPerPost,
    results: []
  })

  const params: Record<string, unknown> = {}
  const where = await buildPostWhere(db, criteria, viewer, params)
  if (where === null) return empty()

  if (!hasKeywords) {
    return await runFilterOnlySearch(db, request, where, params)
  }

  const terms = collectSearchTerms(criteria)
  const variantsByText = await expandFuzzyNeedles(db, 'post', terms.map((term) => term.text))
  const needles: Needle[] = terms.map((term) => ({
    termKey: term.key,
    text: clampFtsNeedle(term.text),
    fuzzy: false,
    distance: 0,
    phrase: term.phrase ? createPhraseMatcher(term.text) : null
  }))
  for (const term of terms) {
    for (const variant of variantsByText.get(term.text) ?? []) {
      if (needles.length >= MAX_NEEDLES) break
      needles.push({
        termKey: term.key,
        text: clampFtsNeedle(variant.text),
        fuzzy: true,
        distance: variant.distance,
        phrase: term.phrase ? createPhraseMatcher(variant.text) : null
      })
    }
  }

  const hitsByPost = await collectHits(db, needles)
  if (!hitsByPost.size) return empty()

  params.candidateIds = [...hitsByPost.values()].map((entry) => entry.rawId)
  const postResponse = await queryDb(
    db,
    `SELECT ${POST_FIELDS} FROM post WHERE id IN $candidateIds AND ${where};`,
    params,
    { label: 'search load posts', timeoutMs: 30_000 }
  )

  const results: RankedResult[] = []
  for (const post of queryRows<PostRow>(postResponse, 0)) {
    const postId = stringifyRecordId(post.id)
    const entry = hitsByPost.get(postId)
    if (!entry) continue

    const locked = isLockedForViewer(post, viewer)
    const allowed = (hit: Hit) => !locked || hit.unit === 'title'
    const matchedTerm = (termKey: string, includeFuzzy: boolean) =>
      (entry.hits.get(termKey) ?? []).some((hit) => allowed(hit) && (includeFuzzy || !hit.fuzzy))

    const exact = evaluateSearchExpression(criteria, (key) => matchedTerm(key, false))
    const any = exact || evaluateSearchExpression(criteria, (key) => matchedTerm(key, true))
    if (!any) continue

    const tier: SearchMatchTier = exact ? 'exact' : 'fuzzy'
    const hits = [...entry.hits.values()].flat().filter(allowed)
    const { matches, totalMatches, score } = summarizeHits(hits, maxPerPost)
    results.push({ result: toResult(post, { matches, totalMatches, score, tier, locked }), sortDate: postSortDate(post) })
  }

  sortSearchResults(results, sort)
  return paginate(results, criteria, sort, page, limit, maxPerPost)
}

async function runFilterOnlySearch(
  db: Surreal,
  request: PostSearchRequest,
  where: string,
  params: Record<string, unknown>
): Promise<SearchResponse> {
  const { criteria, sort, page, limit, maxPerPost, viewer } = request
  // Relevance is meaningless without keywords: newest first.
  const order = sort === 'date_asc'
    ? 'sort_date ASC'
    : sort === 'title'
      ? 'sort_title ASC'
      : 'sort_date DESC'
  const response = await queryDb(
    db,
    `SELECT ${POST_FIELDS}, (published_at ?? updated_at) AS sort_date, string::lowercase(title ?? '') AS sort_title
       FROM post WHERE ${where}
       ORDER BY ${order}
       LIMIT $limit START $start;
     SELECT count() AS total FROM post WHERE ${where} GROUP ALL;`,
    { ...params, limit, start: (page - 1) * limit },
    { label: 'search filter-only', timeoutMs: 30_000 }
  )
  const total = Number(queryRows<{ total?: unknown }>(response, 1)[0]?.total ?? 0)
  const results = queryRows<PostRow>(response, 0).map((post) => toResult(post, {
    matches: [],
    totalMatches: 0,
    score: 0,
    tier: 'exact',
    locked: isLockedForViewer(post, viewer)
  }))

  return {
    query: '',
    sort,
    limit,
    page,
    pages: Math.ceil(total / limit),
    total,
    maxPerPost,
    results
  }
}

/**
 * Access + filter conditions for the `post` table. Returns null when a filter
 * can never match, so the caller can short-circuit.
 */
async function buildPostWhere(
  db: Surreal,
  criteria: AdvancedSearchCriteria,
  viewer: PostSearchViewer,
  params: Record<string, unknown>
): Promise<string | null> {
  const conditions = [buildAccessCondition(viewer)]

  const filterIds = await resolveTaxonomyPostIds(db, criteria)
  if (filterIds) {
    if (!filterIds.length) return null
    params.filterIds = filterIds
    conditions.push('id IN $filterIds')
  }

  const { from, to } = resolveSearchDateRange(criteria)
  if (from) {
    params.dateFrom = from
    conditions.push('(published_at ?? updated_at) >= $dateFrom')
  }
  if (to) {
    params.dateTo = to
    conditions.push('(published_at ?? updated_at) <= $dateTo')
  }

  return conditions.map((condition) => `(${condition})`).join(' AND ')
}

/**
 * Mirrors the post page rules:
 *  - owner: every published and draft post
 *  - everyone else: published public / password posts
 * Archived posts are never searchable.
 */
function buildAccessCondition(viewer: PostSearchViewer): string {
  if (viewer.user) {
    return "status IN ['published', 'draft']"
  }
  return "(status = 'published' AND (visibility IS NONE OR visibility IN ['public', 'password']))"
}

function isLockedForViewer(post: PostRow, viewer: PostSearchViewer): boolean {
  if (post.visibility !== 'password') return false
  if (viewer.user) return false
  return !viewer.unlockedIds.has(stringifyRecordId(post.id))
}

/**
 * Post ids allowed by the category (incl. sub-categories) and tag filters.
 * Categories OR together, tags OR together, categories AND tags.
 * Returns null when neither filter is set.
 */
async function resolveTaxonomyPostIds(db: Surreal, criteria: AdvancedSearchCriteria): Promise<unknown[] | null> {
  if (!criteria.categories.length && !criteria.tags.length) return null

  const statements: string[] = []
  const params: Record<string, unknown> = {}
  if (criteria.categories.length) {
    statements.push('SELECT id, slug, parent FROM category;')
  }
  if (criteria.tags.length) {
    params.tagSlugs = criteria.tags
    statements.push('SELECT VALUE in FROM tagged WHERE out.slug IN $tagSlugs;')
  }
  const response = await queryDb(db, statements.join('\n'), params, { label: 'search taxonomy lookup' })

  let allowed: Map<string, unknown> | null = null
  const intersect = (ids: unknown[]) => {
    const next = new Map(ids.map((id) => [stringifyRecordId(id), id] as const))
    allowed = allowed === null
      ? next
      : new Map([...(allowed as Map<string, unknown>)].filter(([key]) => next.has(key)))
  }

  if (criteria.categories.length) {
    const categoryIds = expandCategoryIds(queryRows<Record<string, unknown>>(response, 0), criteria.categories)
    if (!categoryIds.length) return []
    const categoryResponse = await queryDb(
      db,
      'SELECT VALUE in FROM categorized_as WHERE out IN $categoryIds;',
      { categoryIds },
      { label: 'search category posts' }
    )
    intersect(queryRows<unknown>(categoryResponse, 0))
  }
  if (criteria.tags.length) {
    intersect(queryRows<unknown>(response, criteria.categories.length ? 1 : 0))
  }

  return [...((allowed as Map<string, unknown> | null)?.values() ?? [])]
}

/** Raw ids of the selected categories and all of their descendants. */
export function expandCategoryIds(rows: Record<string, unknown>[], slugs: string[]): unknown[] {
  const childrenByParent = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const parent = row.parent ? stringifyRecordId(row.parent) : ''
    if (!parent) continue
    const list = childrenByParent.get(parent) ?? []
    list.push(row)
    childrenByParent.set(parent, list)
  }

  const wanted = new Set(slugs)
  const result = new Map<string, unknown>()
  const queue = rows.filter((row) => wanted.has(String(row.slug ?? '')))
  while (queue.length) {
    const row = queue.shift()!
    const key = stringifyRecordId(row.id)
    if (!key || result.has(key)) continue
    result.set(key, row.id)
    queue.push(...(childrenByParent.get(key) ?? []))
  }
  return [...result.values()]
}

/**
 * Run every needle against block text and post title / summary in a single
 * round trip, grouping hits by post and term.
 */
async function collectHits(db: Surreal, needles: Needle[]) {
  const statements: string[] = []
  const params: Record<string, unknown> = { hlOpen: HIGHLIGHT_OPEN, hlClose: HIGHLIGHT_CLOSE, rowLimit: NEEDLE_ROW_LIMIT }
  needles.forEach((needle, index) => {
    params[`n_${index}`] = needle.text
    statements.push(
      // Blocks: walk back to owning posts via the current version only.
      `SELECT id, type, text,
          search::score(0) AS score,
          search::highlight($hlOpen, $hlClose, 0) AS snippet,
          <-has_blocks<-versions[WHERE version = 'current']<-has_version<-post AS owners
        FROM block WHERE text @0@ $n_${index}
        ORDER BY score DESC LIMIT $rowLimit;`,
      `SELECT id, title, summary,
          search::score(0) AS title_score,
          search::score(1) AS summary_score,
          search::highlight($hlOpen, $hlClose, 0) AS title_snippet,
          search::highlight($hlOpen, $hlClose, 1) AS summary_snippet
        FROM post WHERE status != 'archived' AND (title @0@ $n_${index} OR summary @1@ $n_${index})
        LIMIT $rowLimit;`
    )
  })

  const response = await queryDb(db, statements.join('\n'), params, { label: 'search full-text', timeoutMs: 30_000 })
  const hitsByPost = new Map<string, { rawId: unknown, hits: Map<string, Hit[]> }>()
  const addHit = (rawPostId: unknown, termKey: string, hit: Hit) => {
    const postId = stringifyRecordId(rawPostId)
    if (!postId) return
    let entry = hitsByPost.get(postId)
    if (!entry) {
      entry = { rawId: rawPostId, hits: new Map() }
      hitsByPost.set(postId, entry)
    }
    const list = entry.hits.get(termKey) ?? []
    list.push(hit)
    entry.hits.set(termKey, list)
  }

  needles.forEach((needle, index) => {
    const blocks = queryRows<{ id?: unknown, type?: unknown, text?: unknown, score?: unknown, snippet?: unknown, owners?: unknown[] }>(response, index * 2)
    for (const block of blocks) {
      const text = String(block.text ?? '')
      if (needle.phrase && !needle.phrase(text)) continue
      const hit: Hit = {
        unit: 'block',
        unitId: stringifyRecordId(block.id),
        type: String(block.type ?? 'paragraph'),
        snippet: String(block.snippet ?? text),
        score: Number(block.score ?? 0),
        fuzzy: needle.fuzzy,
        distance: needle.distance
      }
      for (const owner of block.owners ?? []) addHit(owner, needle.termKey, hit)
    }

    const posts = queryRows<Record<string, unknown>>(response, index * 2 + 1)
    for (const post of posts) {
      const postId = stringifyRecordId(post.id)
      const titleSnippet = String(post.title_snippet ?? '')
      const summarySnippet = String(post.summary_snippet ?? '')
      // BM25 can score a real match as 0 (term in most docs); the highlight
      // markers are the reliable signal of which field matched.
      if (titleSnippet.includes(HIGHLIGHT_OPEN) && (!needle.phrase || needle.phrase(String(post.title ?? '')))) {
        addHit(post.id, needle.termKey, {
          unit: 'title',
          unitId: `title:${postId}`,
          type: 'title',
          snippet: titleSnippet,
          score: Number(post.title_score ?? 0),
          fuzzy: needle.fuzzy,
          distance: needle.distance
        })
      }
      if (summarySnippet.includes(HIGHLIGHT_OPEN) && (!needle.phrase || needle.phrase(String(post.summary ?? '')))) {
        addHit(post.id, needle.termKey, {
          unit: 'summary',
          unitId: `summary:${postId}`,
          type: 'summary',
          snippet: summarySnippet,
          score: Number(post.summary_score ?? 0),
          fuzzy: needle.fuzzy,
          distance: needle.distance
        })
      }
    }
  })

  return hitsByPost
}

function unitWeight(unit: MatchUnit) {
  return unit === 'title' ? TITLE_WEIGHT : unit === 'summary' ? SUMMARY_WEIGHT : BLOCK_WEIGHT
}

/** Weighted relevance of one hit; the +0.1 keeps zero-BM25 matches meaningful. */
function hitScore(hit: Hit) {
  return (hit.score + 0.1) * unitWeight(hit.unit) * fuzzyPenalty(hit.fuzzy ? hit.distance : 0)
}

/** De-duplicate hits per unit (best hit wins) and build the displayed matches. */
function summarizeHits(hits: Hit[], maxPerPost: number) {
  const bestByUnit = new Map<string, Hit>()
  for (const hit of hits) {
    const current = bestByUnit.get(hit.unitId)
    if (!current || compareHits(hit, current) < 0) bestByUnit.set(hit.unitId, hit)
  }
  const ordered = [...bestByUnit.values()].sort(compareHits)
  const score = ordered.reduce((sum, hit) => sum + hitScore(hit), 0)
  const matches: SearchBlockMatch[] = ordered.slice(0, maxPerPost).map((hit) => ({
    blockId: hit.unitId,
    type: hit.type,
    snippet: toSafeSnippet(hit.snippet),
    score: hitScore(hit)
  }))
  return { matches, totalMatches: ordered.length, score }
}

/** Exact before fuzzy, then title > summary > block, then score. */
function compareHits(a: Hit, b: Hit) {
  if (a.fuzzy !== b.fuzzy) return a.fuzzy ? 1 : -1
  const unitOrder = unitWeight(b.unit) - unitWeight(a.unit)
  if (unitOrder) return unitOrder
  return hitScore(b) - hitScore(a)
}

function toResult(
  post: PostRow,
  extra: { matches: SearchBlockMatch[], totalMatches: number, score: number, tier: SearchMatchTier, locked: boolean }
): SearchPostResult {
  return {
    post: {
      id: stringifyRecordId(post.id),
      slug: String(post.slug ?? ''),
      title: String(post.title ?? ''),
      summary: typeof post.summary === 'string' && post.summary.trim() ? post.summary : null,
      cover_image: typeof post.cover_image === 'string' ? post.cover_image : null,
      published_at: post.published_at ? String(post.published_at) : null,
      view_count: Number(post.view_count ?? 0),
      word_count: Number(post.word_count ?? 0),
      cjk_char_count: Number(post.cjk_char_count ?? 0),
      visibility: normalizeVisibility(post.visibility)
    },
    score: extra.score,
    matches: extra.matches,
    totalMatches: extra.totalMatches,
    tier: extra.tier,
    status: normalizeStatus(post.status),
    locked: extra.locked
  }
}

/** Drafts have no published_at; their last edit is used for date sorting / filters. */
function postSortDate(post: PostRow): number {
  return dateValue(post.published_at ?? post.updated_at)
}

function normalizeVisibility(value: unknown): PostVisibility {
  return value === 'private' || value === 'password' ? value : 'public'
}

function normalizeStatus(value: unknown): PostStatus {
  return value === 'draft' || value === 'archived' ? value : 'published'
}

function dateValue(value: unknown): number {
  if (!value) return 0
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value))
  return Number.isFinite(time) ? time : 0
}

export interface RankedResult {
  result: SearchPostResult
  sortDate: number
}

/** Exact tier first, then the requested order. */
export function sortSearchResults(results: RankedResult[], sort: SearchSort) {
  const tierRank = (item: RankedResult) => item.result.tier === 'exact' ? 0 : 1
  results.sort((a, b) => {
    const tier = tierRank(a) - tierRank(b)
    if (tier) return tier
    switch (sort) {
      case 'date_desc':
        return b.sortDate - a.sortDate
      case 'date_asc':
        return a.sortDate - b.sortDate
      case 'title':
        return a.result.post.title.localeCompare(b.result.post.title)
      case 'relevance':
      default:
        return b.result.score - a.result.score || b.sortDate - a.sortDate
    }
  })
}

function paginate(
  results: RankedResult[],
  criteria: AdvancedSearchCriteria,
  sort: SearchSort,
  page: number,
  limit: number,
  maxPerPost: number
): SearchResponse {
  const total = results.length
  const start = (page - 1) * limit
  return {
    query: describeSearchKeywords(criteria),
    sort,
    limit,
    page,
    pages: Math.ceil(total / limit),
    total,
    maxPerPost,
    results: results.slice(start, start + limit).map((item) => item.result)
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * SurrealDB's `search::highlight` wraps matches with the given markers but does
 * NOT HTML-escape the surrounding indexed text. Since `block.text` can contain
 * literal HTML (code blocks, custom-html source), rendering the snippet via
 * `v-html` is a stored-XSS sink. We escape the whole string, then restore only
 * the trusted `<mark>` tags from the sentinel markers.
 */
export function toSafeSnippet(raw: string): string {
  return escapeHtml(raw)
    .split(HIGHLIGHT_OPEN).join('<mark>')
    .split(HIGHLIGHT_CLOSE).join('</mark>')
}
