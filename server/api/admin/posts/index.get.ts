import { queryDb, useDb } from '../../../utils/db'
import { normalizePost } from '../../../utils/content'
import { normalizeCategory, normalizeTag } from '../../../utils/taxonomy'
import { firstRow, queryRows, recordIdPart, stringifyRecordId } from '../../../utils/surrealResult'
import { requireOwner } from '../../../utils/auth'
import type { PostRecord, PostStatus, PostVisibility } from '~/types/content'

const statuses: Array<PostStatus | 'all'> = ['all', 'draft', 'published', 'archived']
const postStatuses: PostStatus[] = ['draft', 'published', 'archived']
const postVisibilities: PostVisibility[] = ['public', 'private', 'password']
const MAX_TITLE_REGEX_LENGTH = 200
const sortOrders = {
  updated_desc: 'updated_at DESC',
  updated_asc: 'updated_at ASC',
  published_desc: 'published_at DESC, updated_at DESC',
  published_asc: 'published_at ASC, updated_at ASC',
  title_asc: 'title ASC, id ASC',
  title_desc: 'title DESC, id ASC',
  status_asc: 'status ASC, updated_at DESC',
  status_desc: 'status DESC, updated_at DESC',
  visibility_asc: 'visibility ASC, updated_at DESC',
  visibility_desc: 'visibility DESC, updated_at DESC',
  length_asc: 'word_count ASC, cjk_char_count ASC, id ASC',
  length_desc: 'word_count DESC, cjk_char_count DESC, id ASC'
} as const
type AdminPostSort = keyof typeof sortOrders

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const query = getQuery(event)
  const limit = normalizeLimit(query.limit)
  const start = normalizeStart(query.start)
  const status = statuses.includes(query.status as PostStatus) ? query.status as PostStatus | 'all' : 'all'
  const statusList = normalizeEnumList(query.statuses, postStatuses)
  const visibilityList = normalizeEnumList(query.visibilities, postVisibilities)
  const titleRegex = normalizeTitleRegex(query.title)
  const lengthMin = normalizeCount(query.length_min)
  const lengthMax = normalizeCount(query.length_max)
  const publishedFrom = normalizeDateStart(query.published_from)
  const publishedTo = normalizeDateEndExclusive(query.published_to)
  const updatedFrom = normalizeDateStart(query.updated_from)
  const updatedTo = normalizeDateEndExclusive(query.updated_to)
  const sort = normalizeSort(query.sort)
  const tagIds = relationIds(query.tag_ids ?? query.tags, 'tag')
  const categoryIds = relationIds(query.category_ids ?? query.categories, 'category')
  const db = await useDb()
  const filteredPostIds = await resolveFilteredPostIds(db, { tagIds, categoryIds })

  if (filteredPostIds && filteredPostIds.length === 0) {
    return { posts: [], total: 0, limit, start }
  }

  const conditions: string[] = []
  const params: Record<string, unknown> = {
    limit,
    start
  }

  if (statusList.length) {
    conditions.push('status IN $statuses')
    params.statuses = statusList
  } else if (status !== 'all') {
    conditions.push('status = $status')
    params.status = status
  } else {
    conditions.push('status != "archived"')
  }

  if (visibilityList.length) {
    conditions.push('visibility IN $visibilities')
    params.visibilities = visibilityList
  }

  if (titleRegex) {
    conditions.push('string::matches(title, $titleRegex)')
    params.titleRegex = titleRegex
  }

  if (lengthMin !== null) {
    conditions.push('(word_count >= $lengthMin OR cjk_char_count >= $lengthMin)')
    params.lengthMin = lengthMin
  }

  if (lengthMax !== null) {
    conditions.push('(word_count <= $lengthMax OR cjk_char_count <= $lengthMax)')
    params.lengthMax = lengthMax
  }

  if (publishedFrom) {
    conditions.push('published_at != NONE AND published_at >= $publishedFrom')
    params.publishedFrom = publishedFrom
  }

  if (publishedTo) {
    conditions.push('published_at != NONE AND published_at < $publishedTo')
    params.publishedTo = publishedTo
  }

  if (updatedFrom) {
    conditions.push('updated_at >= $updatedFrom')
    params.updatedFrom = updatedFrom
  }

  if (updatedTo) {
    conditions.push('updated_at < $updatedTo')
    params.updatedTo = updatedTo
  }

  if (filteredPostIds) {
    conditions.push('id IN $postIds')
    params.postIds = filteredPostIds
  }

  const where = conditions.join(' AND ')
  const orderBy = sortOrders[sort]

  const response = await queryDb(
    db,
    `SELECT id, title, slug, summary, status, cover_image,
      published_at, created_at, updated_at, view_count, word_count, cjk_char_count,
      visibility, password_hint
     FROM post WHERE ${where} ORDER BY ${orderBy} LIMIT $limit START $start;
     SELECT count() AS total FROM post WHERE ${where} GROUP ALL;`,
    params
  )

  const postRows = queryRows<Record<string, unknown>>(response, 0)
  const posts = postRows.map(normalizePost)
  const count = firstRow<{ total?: number }>(response, 1)
  const taxonomyByPost = await loadTaxonomyForPosts(db, postRows.map((post) => post.id).filter(Boolean))
  const postsWithTaxonomy = posts.map((post) => {
    const tagIds = taxonomyByPost.tagIdsByPost.get(post.id) ?? []
    const categoryIds = taxonomyByPost.categoryIdsByPost.get(post.id) ?? []

    return {
      ...post,
      tag_ids: tagIds,
      category_ids: categoryIds,
      tags: taxonomyByPost.tagsByPost.get(post.id) ?? [],
      categories: taxonomyByPost.categoriesByPost.get(post.id) ?? []
    }
  })

  return {
    posts: postsWithTaxonomy satisfies PostRecord[],
    total: Number(count?.total ?? postsWithTaxonomy.length),
    limit,
    start
  }
})

function normalizeSort(value: unknown): AdminPostSort {
  return Object.keys(sortOrders).includes(String(value)) ? value as AdminPostSort : 'updated_desc'
}

function normalizeEnumList<T extends string>(value: unknown, allowed: T[]): T[] {
  const values = Array.isArray(value) ? value : [value]
  const allowedSet = new Set<string>(allowed)

  return Array.from(new Set(
    values
      .flatMap((entry) => String(entry ?? '').split(','))
      .map((entry) => entry.trim())
      .filter((entry): entry is T => allowedSet.has(entry))
  ))
}

function normalizeTitleRegex(value: unknown): string | null {
  const pattern = String(value ?? '').trim()
  if (!pattern) {
    return null
  }

  if (pattern.length > MAX_TITLE_REGEX_LENGTH) {
    return null
  }

  try {
    // Validate syntax; if invalid, skip the filter rather than break the query.
    void new RegExp(pattern)
  } catch {
    return null
  }

  // Prepend the case-insensitive inline flag (Rust regex syntax).
  return `(?i)${pattern}`
}

function normalizeCount(value: unknown): number | null {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null
  }

  const count = Number(value)
  return Number.isFinite(count) ? Math.max(Math.trunc(count), 0) : null
}

function normalizeDateStart(value: unknown): Date | null {
  const raw = String(value ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null
  }

  const date = new Date(`${raw}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? null : date
}

function normalizeDateEndExclusive(value: unknown): Date | null {
  const start = normalizeDateStart(value)
  if (!start) {
    return null
  }

  return new Date(start.getTime() + 24 * 60 * 60 * 1000)
}


function normalizeLimit(value: unknown) {
  const limit = Number(value ?? 10)
  return Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 10
}

function normalizeStart(value: unknown) {
  const start = Number(value ?? 0)
  return Number.isFinite(start) ? Math.max(start, 0) : 0
}

function relationIds(value: unknown, table: 'category' | 'tag') {
  const values = Array.isArray(value) ? value : [value]

  return Array.from(new Set(
    values
      .flatMap((entry) => String(entry ?? '').split(','))
      .map((entry) => recordIdPart(entry.trim(), table))
      .filter(Boolean)
  ))
}

async function resolveFilteredPostIds(
  db: Awaited<ReturnType<typeof useDb>>,
  filters: { tagIds: string[], categoryIds: string[] }
) {
  const groups: unknown[][] = []

  if (filters.tagIds.length) {
    groups.push(await relationPostIds(db, 'tag', 'tagged', filters.tagIds))
  }

  if (filters.categoryIds.length) {
    groups.push(await relationPostIds(db, 'category', 'categorized_as', await expandCategoryIds(db, filters.categoryIds)))
  }

  if (!groups.length) {
    return null
  }

  const maps = groups.map((group) => new Map(group.map((id) => [stringifyRecordId(id), id])))
  const [firstMap] = maps
  if (!firstMap) {
    return []
  }

  return Array.from(firstMap.keys())
    .filter((key) => maps.every((map) => map.has(key)))
    .map((key) => firstMap.get(key))
}

async function expandCategoryIds(db: Awaited<ReturnType<typeof useDb>>, ids: string[]) {
  const response = await queryDb(db, 'SELECT id, parent FROM category;')
  const categories = queryRows<Record<string, unknown>>(response).map((category) => ({
    id: recordIdPart(stringifyRecordId(category.id), 'category'),
    parentId: category.parent ? recordIdPart(stringifyRecordId(category.parent), 'category') : null
  }))
  const selected = new Set(ids)
  let changed = true

  while (changed) {
    changed = false

    for (const category of categories) {
      if (category.parentId && selected.has(category.parentId) && !selected.has(category.id)) {
        selected.add(category.id)
        changed = true
      }
    }
  }

  return Array.from(selected)
}

async function relationPostIds(
  db: Awaited<ReturnType<typeof useDb>>,
  table: 'category' | 'tag',
  relation: 'categorized_as' | 'tagged',
  ids: string[]
) {
  const postIds: unknown[] = []

  for (const id of ids) {
    const response = await queryDb(
      db,
      `SELECT in FROM ${relation} WHERE out = type::record($table, $id);`,
      { table, id }
    )
    postIds.push(...queryRows<Record<string, unknown>>(response).map((row) => row.in).filter(Boolean))
  }

  return postIds
}

async function loadTaxonomyForPosts(db: Awaited<ReturnType<typeof useDb>>, postIds: unknown[]) {
  const tagIdsByPost = new Map<string, string[]>()
  const categoryIdsByPost = new Map<string, string[]>()
  const tagsByPost = new Map<string, ReturnType<typeof normalizeTag>[]>()
  const categoriesByPost = new Map<string, ReturnType<typeof normalizeCategory>[]>()

  if (!postIds.length) {
    return { tagIdsByPost, categoryIdsByPost, tagsByPost, categoriesByPost }
  }

  const response = await queryDb(
    db,
    `SELECT in AS post_id, out.id AS tag_id, out.name AS tag_name, out.slug AS tag_slug
     FROM tagged
     WHERE in IN $postIds
     FETCH out;
     SELECT in AS post_id, out.id AS category_id, out.name AS category_name,
       out.slug AS category_slug, out.description AS category_description, out.parent AS category_parent
     FROM categorized_as
     WHERE in IN $postIds
     FETCH out;`,
    { postIds }
  )

  for (const row of queryRows<Record<string, unknown>>(response, 0)) {
    const postId = stringifyRecordId(row.post_id)
    const tag = normalizeTag({
      id: row.tag_id,
      name: row.tag_name,
      slug: row.tag_slug
    })

    if (!postId || !tag.id || !tag.name) {
      continue
    }

    tagIdsByPost.set(postId, [...(tagIdsByPost.get(postId) ?? []), tag.id])
    tagsByPost.set(postId, [...(tagsByPost.get(postId) ?? []), tag])
  }

  for (const row of queryRows<Record<string, unknown>>(response, 1)) {
    const postId = stringifyRecordId(row.post_id)
    const category = normalizeCategory({
      id: row.category_id,
      name: row.category_name,
      slug: row.category_slug,
      description: row.category_description,
      parent: row.category_parent
    })

    if (!postId || !category.id || !category.name) {
      continue
    }

    categoryIdsByPost.set(postId, [...(categoryIdsByPost.get(postId) ?? []), category.id])
    categoriesByPost.set(postId, [...(categoriesByPost.get(postId) ?? []), category])
  }

  return { tagIdsByPost, categoryIdsByPost, tagsByPost, categoriesByPost }
}