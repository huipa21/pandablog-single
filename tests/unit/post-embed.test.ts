import { describe, expect, it } from 'vitest'
import type { JsonContent } from '../../types/content'
import { collectPostEmbedIds } from '../../server/utils/postEmbedResolve'
import { collectPostEmbedIds as collectClientIds } from '../../extensions/postEmbed'
import { isEmptyBlock } from '../../utils/emptyBlocks'

describe('post embed resolution', () => {
  const doc: JsonContent = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [
        { type: 'text', text: 'see ' },
        { type: 'postEmbedInline', attrs: { postId: 'post:chip-1', slug: 'chip', title: 'Chip post' } }
      ] },
      { type: 'postEmbed', attrs: { postId: 'post:card-1', slug: 'card', title: 'Card post', blockWidth: 'wide', showCover: true } },
      { type: 'postEmbed', attrs: { postId: 'post:card-1' } },
      { type: 'postEmbed', attrs: { postId: '' } },
      { type: 'columnsBlock', content: [
        { type: 'columnItem', content: [
          { type: 'paragraph', content: [{ type: 'postEmbedInline', attrs: { postId: 'post:chip-2' } }] }
        ] }
      ] }
    ]
  }

  it('collects post ids from cards and inline chips anywhere in the tree', () => {
    expect([...collectPostEmbedIds(doc)].sort()).toEqual(['post:card-1', 'post:chip-1', 'post:chip-2'])
  })

  it('matches the client-side walker in extensions/postEmbed', () => {
    expect([...collectClientIds(doc)].sort()).toEqual([...collectPostEmbedIds(doc)].sort())
  })

  it('ignores other nodes and skips empty anchors', () => {
    const ids = collectPostEmbedIds({ type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'plain' }] },
      { type: 'videoEmbed', attrs: { videoId: 'abc' } },
      { type: 'postEmbed', attrs: { slug: 'no-anchor' } }
    ] })
    expect(ids.size).toBe(0)
  })

  it('keeps embedded post blocks during empty-block stripping', () => {
    expect(isEmptyBlock({ type: 'postEmbed', attrs: { postId: 'post:x' } })).toBe(false)
    expect(isEmptyBlock({ type: 'postEmbedInline', attrs: { postId: 'post:x' } })).toBe(false)
  })
})
