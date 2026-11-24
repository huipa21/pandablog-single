import type { Surreal } from 'surrealdb'
import type { JsonContent } from '~/types/content'
import { queryDb } from './db'
import { queryRows, recordIdPart, stringifyRecordId } from './surrealResult'

export interface PostEmbedTarget {
  id: string
  slug: string
  title: string
  cover_image: string | null
}

const POST_EMBED_NODE_TYPES = new Set(['postEmbed', 'postEmbedInline'])
const MAX_EMBED_IDS = 40

function isPostEmbedNode(node: unknown): node is { type: string, attrs?: Record<string, unknown>, content?: unknown[] } {
  return Boolean(node && typeof node === 'object' && POST_EMBED_NODE_TYPES.has(String((node as { type?: string }).type)))
}

/** Collect `postId` anchors from embedded post nodes anywhere in a Tiptap JSON subtree. */
export function collectPostEmbedIds(node: unknown, into: Set<string> = new Set()): Set<string> {
  const value = node as { type?: string, attrs?: Record<string, unknown>, content?: unknown[] } | null | undefined
  if (!value || typeof value !== 'object') {
    return into
  }

  if (isPostEmbedNode(value)) {
    const id = String(value.attrs?.postId ?? '').trim()
    if (id) into.add(id)
    return into
  }

  if (Array.isArray(value.content)) {
    value.content.forEach(child => collectPostEmbedIds(child, into))
  }

  return into
}

/**
 * Look up the current summary of embedded posts by their `postId` anchors.
 * `includeRestricted` (owner preview) also returns draft/private targets so
 * the owner sees what a published page will look like for themselves.
 */
export async function fetchPostEmbedTargets(db: Surreal, ids: string[], includeRestricted: boolean): Promise<Map<string, PostEmbedTarget>> {
  const unique = [...new Set(ids.map(id => recordIdPart(id, 'post')).filter(Boolean))].slice(0, MAX_EMBED_IDS)
  const found = new Map<string, PostEmbedTarget>()
  if (!unique.length) {
    return found
  }

  const placeholders = unique.map((_, index) => `type::record('post', $p${index})`)
  const params: Record<string, unknown> = {}
  unique.forEach((id, index) => {
    params[`p${index}`] = id
  })
  const statusFilter = includeRestricted ? '' : 'AND status = "published" AND (visibility IN ["public", "password"] OR visibility IS NONE)'

  const response = await queryDb(
    db,
    `SELECT id, slug, title, cover_image, status FROM post
     WHERE id IN [${placeholders.join(', ')}] ${statusFilter};`,
    params,
    { label: 'post embed resolve' }
  )

  for (const row of queryRows<Record<string, unknown>>(response)) {
    const id = stringifyRecordId(row.id)
    const slug = String(row.slug ?? '')
    if (!id || !slug) continue
    found.set(id, {
      id,
      slug,
      title: String(row.title ?? ''),
      cover_image: row.cover_image === undefined || row.cover_image === null ? null : String(row.cover_image)
    })
  }

  return found
}

/**
 * Server-side resolution for public rendering: attach the live target summary
 * to each embedded post node as `attrs.resolved`, so the page renders with the
 * current title and cover image. Unresolvable anchors (deleted, draft for
 * non-owners) get `resolved: null` and render as an unavailable placeholder.
 */
export async function resolvePostEmbedsInDoc(db: Surreal, doc: JsonContent, includeRestricted: boolean): Promise<JsonContent> {
  const ids = collectPostEmbedIds(doc)
  if (!ids.size) {
    return doc
  }

  const targets = await fetchPostEmbedTargets(db, [...ids], includeRestricted)
  const walk = (node: unknown): unknown => {
    const value = node as { type?: string, attrs?: Record<string, unknown>, content?: unknown[] } | null | undefined
    if (!value || typeof value !== 'object') {
      return value
    }

    if (isPostEmbedNode(value)) {
      const postId = String(value.attrs?.postId ?? '').trim()
      return {
        ...value,
        attrs: {
          ...value.attrs,
          resolved: postId ? targets.get(postId) ?? null : null
        }
      }
    }

    if (Array.isArray(value.content)) {
      return { ...value, content: value.content.map(walk) }
    }

    return value
  }

  return walk(doc) as JsonContent
}
