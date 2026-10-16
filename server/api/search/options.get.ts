import { queryDb, useDb } from '../../utils/db'
import { queryRows, stringifyRecordId } from '../../utils/surrealResult'
import type { SearchOptionCategory, SearchOptionTag, SearchOptionsResponse } from '~/types/content'

/**
 * Autocomplete data for the public advanced search: tags and categories (with
 * sub-category roll-up) that have at least one published, non-private post.
 * Filtering happens client-side (plain substring matching, not fuzzy).
 */
export default defineEventHandler(async (event): Promise<SearchOptionsResponse> => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=60')

  const db = await useDb()
  const visiblePost = `in.status = 'published' AND (in.visibility IS NONE OR in.visibility IN ['public', 'password'])`
  const response = await queryDb(
    db,
    `SELECT id, name, slug FROM tag;
     SELECT out, count() AS total FROM tagged WHERE ${visiblePost} GROUP BY out;
     SELECT id, name, slug, parent FROM category;
     SELECT out, count() AS total FROM categorized_as WHERE ${visiblePost} GROUP BY out;`,
    undefined,
    { label: 'search options' }
  )

  const tagCounts = countByOut(queryRows<Record<string, unknown>>(response, 1))
  const tags: SearchOptionTag[] = queryRows<Record<string, unknown>>(response, 0)
    .map((tag) => ({
      slug: String(tag.slug ?? ''),
      name: String(tag.name ?? tag.slug ?? ''),
      count: tagCounts.get(stringifyRecordId(tag.id)) ?? 0
    }))
    .filter((tag) => tag.slug && tag.count > 0)
    .sort((a, b) => a.name.localeCompare(b.name))

  const categories = buildCategoryOptions(
    queryRows<Record<string, unknown>>(response, 2),
    countByOut(queryRows<Record<string, unknown>>(response, 3))
  )

  return { tags, categories }
})

function countByOut(rows: Record<string, unknown>[]) {
  return new Map(rows.map((row) => [stringifyRecordId(row.out), Number(row.total ?? 0)] as const))
}

function buildCategoryOptions(rows: Record<string, unknown>[], directCounts: Map<string, number>): SearchOptionCategory[] {
  const nodes = rows.map((row) => ({
    id: stringifyRecordId(row.id),
    slug: String(row.slug ?? ''),
    name: String(row.name ?? row.slug ?? ''),
    parentId: row.parent ? stringifyRecordId(row.parent) : ''
  })).filter((node) => node.id && node.slug)
  const byId = new Map(nodes.map((node) => [node.id, node]))

  const ancestorsOf = (node: typeof nodes[number]) => {
    const chain: typeof nodes = []
    const seen = new Set<string>([node.id])
    let parent = node.parentId ? byId.get(node.parentId) : undefined
    while (parent && !seen.has(parent.id)) {
      chain.unshift(parent)
      seen.add(parent.id)
      parent = parent.parentId ? byId.get(parent.parentId) : undefined
    }
    return chain
  }

  // Roll direct post counts up to every ancestor (sub-categories are included).
  const totals = new Map<string, number>()
  for (const node of nodes) {
    const direct = directCounts.get(node.id) ?? 0
    if (!direct) continue
    for (const target of [node, ...ancestorsOf(node)]) {
      totals.set(target.id, (totals.get(target.id) ?? 0) + direct)
    }
  }

  return nodes
    .map((node) => {
      const chain = ancestorsOf(node)
      const parent = node.parentId ? byId.get(node.parentId) : undefined
      return {
        slug: node.slug,
        name: node.name,
        label: [...chain.map((item) => item.name), node.name].join(' \u203a '),
        parent: parent?.slug ?? null,
        count: totals.get(node.id) ?? 0
      }
    })
    .filter((category) => category.count > 0)
    .sort((a, b) => a.label.localeCompare(b.label))
}
