import { mergeAttributes, Node } from '@tiptap/core'

/**
 * Shared attributes for both the block-level card and the inline chip variant.
 * `postId` is the anchor: it survives title and slug changes on the target
 * post. `slug` and `title` are snapshots taken at insert time — used as a
 * display fallback while resolving and to identify the target when the post
 * is gone (draft/archived/deleted).
 */
function postEmbedAttributes() {
  return {
    postId: {
      default: '',
      parseHTML: (element: HTMLElement) => element.getAttribute('data-post-id') || '',
      renderHTML: (attributes: Record<string, unknown>) => ({ 'data-post-id': attributes.postId || '' })
    },
    slug: {
      default: '',
      parseHTML: (element: HTMLElement) => element.getAttribute('data-slug') || '',
      renderHTML: (attributes: Record<string, unknown>) => ({ 'data-slug': attributes.slug || '' })
    },
    title: {
      default: '',
      parseHTML: (element: HTMLElement) => element.getAttribute('data-title') || '',
      renderHTML: (attributes: Record<string, unknown>) => ({ 'data-title': attributes.title || '' })
    },
    customLabel: {
      default: '',
      parseHTML: (element: HTMLElement) => element.getAttribute('data-custom-label') || '',
      renderHTML: (attributes: Record<string, unknown>) => ({ 'data-custom-label': attributes.customLabel || '' })
    },
    blockWidth: {
      default: 'content',
      parseHTML: (element: HTMLElement) => element.getAttribute('data-block-width') || 'content',
      renderHTML: (attributes: Record<string, unknown>) => ({ 'data-block-width': attributes.blockWidth || 'content' })
    },
    showCover: {
      default: true,
      parseHTML: (element: HTMLElement) => element.getAttribute('data-show-cover') !== 'false',
      renderHTML: (attributes: Record<string, unknown>) => ({ 'data-show-cover': attributes.showCover !== false })
    }
  }
}

export const POST_EMBED_TYPES = new Set(['postEmbed', 'postEmbedInline'])

export function isPostEmbedNode(node: { type?: string } | null | undefined): boolean {
  return Boolean(node && POST_EMBED_TYPES.has(String(node.type)))
}

/** Recursively collect `postId` anchors from postEmbed nodes inside a Tiptap JSON subtree. */
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
 * Embedded post card — block level, atom, draggable. Displayed like a
 * PostCardList entry (optional cover + title) and links to `/blog/<slug>`.
 */
export const PostEmbedNode = Node.create({
  name: 'postEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return postEmbedAttributes()
  },

  parseHTML() {
    return [{ tag: 'div[data-type="post-embed"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'post-embed', class: 'post-embed-nodeview' })]
  }
})

/**
 * Inline variant — a compact chip rendered inside paragraph text. Title only,
 * so it stays readable inline. The card/inline presentation is switchable from
 * the block settings panel, which converts between the two node types.
 */
export const PostEmbedInlineNode = Node.create({
  name: 'postEmbedInline',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return postEmbedAttributes()
  },

  parseHTML() {
    return [{ tag: 'span[data-type="post-embed-inline"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-type': 'post-embed-inline', class: 'post-embed-inline-nodeview' })]
  }
})
