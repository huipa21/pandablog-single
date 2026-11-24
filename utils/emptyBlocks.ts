import type { JsonContent } from '~/types/content'
import { normalizePresentationNode } from '~/utils/blockPresentation'

const TEXT_BEARING_BLOCK_TYPES = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem'
])

export function stripEmptyBlocks(doc: JsonContent | null | undefined): JsonContent | null {
  if (!doc) return null
  if (!Array.isArray(doc.content)) return doc

  return {
    ...doc,
    content: doc.content.filter((node) => !isEmptyBlock(node))
  }
}

export function isEmptyBlock(node: JsonContent | null | undefined): boolean {
  if (!node || !node.type) return true

  if (TEXT_BEARING_BLOCK_TYPES.has(node.type)) {
    return flattenText(node).trim().length === 0
  }

  if (node.type === 'codeBlock') {
    return flattenText(node).trim().length === 0
  }

  if (node.type === 'image') {
    return stringAttr(node.attrs?.src).length === 0
  }

  if (node.type === 'mediaText') {
    return !hasItems(node.attrs?.mediaItems) && stringAttr(node.attrs?.mediaSrc).length === 0 && stringAttr(node.attrs?.src).length === 0
  }

  if (node.type === 'filesBlock') {
    return !hasItems(node.attrs?.files)
  }

  // Embedded post nodes without an anchor would render as a permanent
  // "choose post" placeholder — drop them like other empty atoms.
  if (node.type === 'postEmbed' || node.type === 'postEmbedInline') {
    return stringAttr(node.attrs?.postId).length === 0
  }

  return false
}

/**
 * Produce a canonicalised copy of a Tiptap doc used for both persistence and
 * change-detection. It recursively:
 *   - drops empty blocks at every nesting level (not just the top level),
 *   - trims leading/trailing whitespace at each text-bearing block's edges and
 *     removes text nodes that become empty,
 *   - rebuilds every node with a stable key order and sorted attribute keys so
 *     that structurally-identical docs serialise identically.
 *
 * `blockId` attributes are preserved (the server relies on them) unless
 * `stripBlockId` is set — used by the DB dirty-check so server-minted ids don't
 * register as edits.
 */
export function normalizeDocForSave(doc: JsonContent | null | undefined): JsonContent | null {
  if (!doc) return null
  return normalizeNode(doc, false)
}

/**
 * Same as {@link normalizeDocForSave} but additionally strips `blockId`
 * attributes so change-detection ignores id churn between the raw server
 * payload and the editor's re-serialised output.
 */
export function normalizeDocForComparison(doc: JsonContent | null | undefined): JsonContent | null {
  if (!doc) return null
  return normalizeNode(doc, true)
}

function normalizeNode(node: JsonContent, stripBlockId: boolean): JsonContent {
  node = normalizePresentationNode(node)
  const out: JsonContent = {}

  if (typeof node.type === 'string') {
    out.type = node.type
  }

  if (node.attrs && typeof node.attrs === 'object' && !Array.isArray(node.attrs)) {
    const attrs = sortedAttrs(node.attrs as Record<string, unknown>, stripBlockId)
    if (attrs) {
      out.attrs = attrs
    }
  }

  if (Array.isArray(node.content)) {
    const normalized = node.content
      .filter((child): child is JsonContent => Boolean(child) && typeof child === 'object')
      .map((child) => normalizeNode(child, stripBlockId))
    const trimmed = trimEdgeWhitespace(normalized)
    out.content = trimmed.filter((child) => !isDroppableChild(child))
  }

  if (typeof node.text === 'string') {
    out.text = node.text
  }

  if (Array.isArray(node.marks)) {
    out.marks = node.marks.map((mark) => {
      // Marks always carry a type; keep the normalized attrs alongside it.
      const normalized = normalizeNode(mark as JsonContent, stripBlockId)
      return normalized.attrs
        ? { type: String(mark.type ?? ''), attrs: normalized.attrs }
        : { type: String(mark.type ?? '') }
    })
  }

  return out
}

function isDroppableChild(child: JsonContent): boolean {
  // Empty text nodes carry no meaning once whitespace has been trimmed.
  if (typeof child.text === 'string' && !Array.isArray(child.content)) {
    return child.text.length === 0
  }
  return isEmptyBlock(child)
}

function trimEdgeWhitespace(children: JsonContent[]): JsonContent[] {
  if (children.length === 0) {
    return children
  }

  const result = children.map((child) => ({ ...child }))

  const first = result[0]
  if (first && typeof first.text === 'string' && !Array.isArray(first.content)) {
    first.text = first.text.replace(/^\s+/, '')
  }

  const last = result[result.length - 1]
  if (last && typeof last.text === 'string' && !Array.isArray(last.content)) {
    last.text = last.text.replace(/\s+$/, '')
  }

  return result
}

function sortedAttrs(attrs: Record<string, unknown>, stripBlockId: boolean): Record<string, unknown> | null {
  const keys = Object.keys(attrs)
    .filter((key) => !(stripBlockId && key === 'blockId'))
    .sort()

  if (keys.length === 0) {
    return null
  }

  const out: Record<string, unknown> = {}
  for (const key of keys) {
    out[key] = attrs[key]
  }
  return out
}

function flattenText(node: JsonContent | null | undefined): string {
  if (!node) return ''
  const ownText = typeof node.text === 'string' ? node.text : ''
  const childText = Array.isArray(node.content) ? node.content.map(flattenText).join('') : ''
  return `${ownText}${childText}`
}

function hasItems(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => Boolean(item && typeof item === 'object'))
}

function stringAttr(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}