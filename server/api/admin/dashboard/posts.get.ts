import { queryDb, useDb } from '../../../utils/db'
import { requireOwner } from '../../../utils/auth'
import { normalizeCategory, normalizeTag } from '../../../utils/taxonomy'
import { queryRows, stringifyRecordId } from '../../../utils/surrealResult'

interface PublishedPostRow {
  id: unknown
  title?: unknown
  slug?: unknown
  word_count?: unknown
  cjk_char_count?: unknown
}

interface RelationRow {
  in?: unknown
  out?: unknown
}

interface DashboardPostItem {
  id: string
  title: string
  slug: string
  word_count: number
  cjk_char_count: number
  content_units: number
}

interface LengthBucket {
  key: string
  min: number
  max: number | null
  label: string
  posts: number
  percent: number
}

const lengthBucketDefinitions = [
  { key: 'under250', min: 0, max: 249, label: '<250' },
  { key: '250to499', min: 250, max: 499, label: '250-499' },
  { key: '500to999', min: 500, max: 999, label: '500-999' },
  { key: '1000to1999', min: 1000, max: 1999, label: '1k-2k' },
  { key: '2000plus', min: 2000, max: null, label: '2k+' }
] satisfies Array<Omit<LengthBucket, 'posts' | 'percent'>>

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const db = await useDb()
  const response = await queryDb(
    db,
    `SELECT id, title, slug, word_count, cjk_char_count FROM post WHERE status = 'published';
     SELECT * FROM category ORDER BY name ASC;
     SELECT * FROM tag ORDER BY name ASC;
     SELECT in, out FROM categorized_as WHERE in.status = 'published';
     SELECT in, out FROM tagged WHERE in.status = 'published';`,
    undefined,
    { label: 'admin posts dashboard' }
  )

  const posts = queryRows<PublishedPostRow>(response, 0).map(normalizeDashboardPost)
  const postMap = new Map(posts.map(post => [post.id, post]))
  const categories = queryRows<Record<string, unknown>>(response, 1).map(normalizeCategory)
  const allTags = queryRows<Record<string, unknown>>(response, 2).map(normalizeTag)
  const tags = allTags.filter(tag => tag.slug !== 'null')
  const categoryMap = new Map(categories.map(category => [category.id, category]))
  const tagMap = new Map(tags.map(tag => [tag.id, tag]))
  const categoryStats = new Map<string, { posts: number, words: number, cjkChars: number, contentUnits: number }>()
  const tagStats = new Map<string, { posts: number }>()

  for (const relation of queryRows<RelationRow>(response, 3)) {
    const post = postMap.get(stringifyRecordId(relation.in))
    const categoryId = stringifyRecordId(relation.out)
    if (!post || !categoryMap.has(categoryId)) continue
    const current = categoryStats.get(categoryId) ?? { posts: 0, words: 0, cjkChars: 0, contentUnits: 0 }
    current.posts += 1
    current.words += post.word_count
    current.cjkChars += post.cjk_char_count
    current.contentUnits += post.content_units
    categoryStats.set(categoryId, current)
  }

  for (const relation of queryRows<RelationRow>(response, 4)) {
    const post = postMap.get(stringifyRecordId(relation.in))
    const tagId = stringifyRecordId(relation.out)
    if (!post || !tagMap.has(tagId)) continue
    const current = tagStats.get(tagId) ?? { posts: 0 }
    current.posts += 1
    tagStats.set(tagId, current)
  }

  const totalPosts = posts.length
  const totalWords = sum(posts, post => post.word_count)
  const totalCjkChars = sum(posts, post => post.cjk_char_count)
  const totalContentUnits = sum(posts, post => post.content_units)
  const categorizedRows = categories.map((category) => {
    const stats = categoryStats.get(category.id) ?? { posts: 0, words: 0, cjkChars: 0, contentUnits: 0 }
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      posts: stats.posts,
      words: stats.words,
      cjk_chars: stats.cjkChars,
      content_units: stats.contentUnits,
      average_words: average(stats.words, stats.posts),
      average_content_units: average(stats.contentUnits, stats.posts),
      post_percent: percent(stats.posts, totalPosts),
      content_unit_percent: percent(stats.contentUnits, totalContentUnits)
    }
  }).sort((a, b) => b.posts - a.posts || a.name.localeCompare(b.name))
  const tagRows = tags.map((tag) => {
    const stats = tagStats.get(tag.id) ?? { posts: 0 }
    return {
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      posts: stats.posts,
      post_percent: percent(stats.posts, totalPosts),
      single_use: stats.posts === 1
    }
  }).sort((a, b) => b.posts - a.posts || a.name.localeCompare(b.name))
  const singleUseTags = tagRows.filter(tag => tag.single_use)

  return {
    summary: {
      total_posts: totalPosts,
      total_words: totalWords,
      average_words: average(totalWords, totalPosts),
      total_cjk_chars: totalCjkChars,
      average_cjk_chars: average(totalCjkChars, totalPosts),
      total_content_units: totalContentUnits,
      average_content_units: average(totalContentUnits, totalPosts),
      total_categories: categories.length,
      used_categories: categorizedRows.filter(category => category.posts > 0).length,
      total_tags: tags.length,
      used_tags: tagRows.filter(tag => tag.posts > 0).length,
      single_use_tags: singleUseTags.length
    },
    extremes: {
      shortest: posts.toSorted((a, b) => a.content_units - b.content_units || a.title.localeCompare(b.title))[0] ?? null,
      longest: posts.toSorted((a, b) => b.content_units - a.content_units || a.title.localeCompare(b.title))[0] ?? null
    },
    categories: categorizedRows,
    tags: tagRows,
    single_use_tags: singleUseTags,
    length_buckets: buildLengthBuckets(posts)
  }
})

function normalizeDashboardPost(row: PublishedPostRow): DashboardPostItem {
  const wordCount = Number(row.word_count ?? 0)
  const cjkCharCount = Number(row.cjk_char_count ?? 0)
  return {
    id: stringifyRecordId(row.id),
    title: String(row.title ?? ''),
    slug: String(row.slug ?? ''),
    word_count: wordCount,
    cjk_char_count: cjkCharCount,
    content_units: wordCount + cjkCharCount
  }
}

function buildLengthBuckets(posts: DashboardPostItem[]): LengthBucket[] {
  const buckets = lengthBucketDefinitions.map(bucket => ({ ...bucket, posts: 0, percent: 0 }))
  for (const post of posts) {
    const bucket = buckets.find(entry => post.content_units >= entry.min && (entry.max === null || post.content_units <= entry.max))
    if (bucket) {
      bucket.posts += 1
    }
  }

  return buckets.map(bucket => ({
    ...bucket,
    percent: percent(bucket.posts, posts.length)
  }))
}

function sum<T>(items: T[], select: (item: T) => number) {
  return items.reduce((total, item) => total + select(item), 0)
}

function average(total: number, count: number) {
  return count > 0 ? Math.round(total / count) : 0
}

function percent(value: number, total: number) {
  return total > 0 ? Math.round((value / total) * 100) : 0
}