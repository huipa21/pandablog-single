import type { H3Event } from 'h3'
import type { GraphEdge, GraphPostVisibility, GraphViewerScope } from '~/types/graph'
import type { SessionUser } from './users'
import { recordIdPart, stringifyRecordId } from './surrealResult'

export interface GraphVisibilityFilter {
  where: string
  params: Record<string, unknown>
  viewerScope: GraphViewerScope
}

export async function graphVisibilityFilterForEvent(event: H3Event): Promise<GraphVisibilityFilter> {
  const { getSessionUser } = await import('./auth')
  const user = await getSessionUser(event)
  return graphVisibilityFilterForUser(user)
}

export function graphVisibilityFilterForUser(user: SessionUser | null): GraphVisibilityFilter {
  const base = 'status = "published"'

  if (!user) {
    return {
      where: `${base} AND (visibility IS NONE OR visibility = "public")`,
      params: {},
      viewerScope: 'anonymous'
    }
  }

  return {
    where: `${base} AND (visibility IS NONE OR visibility IN ["public", "private"])`,
    params: {},
    viewerScope: 'owner'
  }
}

export function graphRecordId(value: unknown): string {
  return stringifyRecordId(value)
}

export function graphRecordIdPart(value: unknown, table: string): string {
  return recordIdPart(stringifyRecordId(value), table)
}

export function graphPostVisibility(value: unknown): GraphPostVisibility {
  return value === 'private' ? 'private' : 'public'
}

export function isSyntheticGraphCategory(slug: string, name = '') {
  const normalizedSlug = slug.trim().toLowerCase()
  const normalizedName = name.trim().toLowerCase()
  return normalizedSlug === 'default' || normalizedSlug === 'uncategorized' || normalizedName === 'default' || normalizedName === 'uncategorized'
}

export function isSyntheticGraphTag(slug: string, name = '') {
  const normalizedSlug = slug.trim().toLowerCase()
  const normalizedName = name.trim().toLowerCase()
  return normalizedSlug === 'null' || normalizedName === 'null'
}

export function addUndirectedLinkEdge(edges: Map<string, GraphEdge>, source: string, target: string) {
  if (!source || !target || source === target) {
    return
  }

  const [left, right] = orderedPair(source, target)
  const id = `link:${left}__${right}`
  if (!edges.has(id)) {
    edges.set(id, { id, source: left, target: right, type: 'link' })
  }
}

export function graphDegreeMap(edges: Iterable<GraphEdge>) {
  const degrees = new Map<string, number>()
  for (const edge of edges) {
    if (edge.type !== 'link') {
      continue
    }
    degrees.set(edge.source, (degrees.get(edge.source) ?? 0) + 1)
    degrees.set(edge.target, (degrees.get(edge.target) ?? 0) + 1)
  }
  return degrees
}

function orderedPair(a: string, b: string): [string, string] {
  return a.localeCompare(b) <= 0 ? [a, b] : [b, a]
}