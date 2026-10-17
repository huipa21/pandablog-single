import { describe, expect, it } from 'vitest'
import { normalizeFootnotesDoc } from '../../utils/footnotes'
import type { JsonContent } from '../../types/content'

describe('normalizeFootnotesDoc', () => {
  it('converts a legacy footnotes heading and assigns reference ids to its list items', () => {
    const doc: JsonContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{
            type: 'text',
            text: '4',
            marks: [{ type: 'footnote', attrs: { id: 'note-a', index: 4 } }]
          }]
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'Footnotes' }] },
        {
          type: 'orderedList',
          content: [{
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note body' }] }]
          }]
        }
      ]
    }

    const result = normalizeFootnotesDoc(doc)

    expect(result.changed).toBe(true)
    expect(result.doc.content).toEqual([
      {
        type: 'paragraph',
        content: [{
          type: 'text',
          text: '1',
          marks: [{ type: 'footnote', attrs: { id: 'note-a', index: 1 } }]
        }]
      },
      {
        type: 'footnotesBlock',
        content: [{
          type: 'orderedList',
          content: [{
            type: 'listItem',
            attrs: { footnoteId: 'note-a' },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note body' }] }]
          }]
        }]
      }
    ])
  })

  it('creates a matching footnotes list when a reference has no footnotes block', () => {
    const doc: JsonContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: '1',
          marks: [{ type: 'footnote', attrs: { id: 'note-a', index: 1 } }]
        }]
      }]
    }

    const result = normalizeFootnotesDoc(doc)

    expect(result.changed).toBe(true)
    expect(result.doc.content?.[1]).toEqual({
      type: 'footnotesBlock',
      content: [{
        type: 'orderedList',
        content: [{
          type: 'listItem',
          attrs: { footnoteId: 'note-a' },
          content: [{ type: 'paragraph', content: [] }]
        }]
      }]
    })
  })

  it('moves an existing footnotes block to the end and renumbers references', () => {
    const doc: JsonContent = {
      type: 'doc',
      content: [
        {
          type: 'footnotesBlock',
          content: [{
            type: 'orderedList',
            content: [{
              type: 'listItem',
              attrs: { footnoteId: 'note-a' },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Footnote 1' }] }]
            }]
          }]
        },
        {
          type: 'paragraph',
          content: [{
            type: 'text',
            text: '8',
            marks: [{ type: 'footnote', attrs: { id: 'note-a', index: 8 } }]
          }]
        }
      ]
    }

    const result = normalizeFootnotesDoc(doc)

    expect(result.changed).toBe(true)
    expect(result.doc.content?.[0]?.type).toBe('paragraph')
    expect(result.doc.content?.[1]).toEqual({
      type: 'footnotesBlock',
      content: [{
        type: 'orderedList',
        content: [{
          type: 'listItem',
          attrs: { footnoteId: 'note-a' },
          content: [{ type: 'paragraph', content: [] }]
        }]
      }]
    })
    expect(result.doc.content?.[0]?.content?.[0]).toMatchObject({
      text: '1',
      marks: [{ type: 'footnote', attrs: { id: 'note-a', index: 1 } }]
    })
  })

  it('moves unsupported standalone blocks out of footnote list items', () => {
    const standaloneBlock: JsonContent = {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Outside the note' }]
    }
    const doc: JsonContent = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{
            type: 'text',
            text: '1',
            marks: [{ type: 'footnote', attrs: { id: 'note-a', index: 1 } }]
          }]
        },
        {
          type: 'footnotesBlock',
          content: [{
            type: 'orderedList',
            content: [{
              type: 'listItem',
              attrs: { footnoteId: 'note-a' },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Note body' }] },
                standaloneBlock
              ]
            }]
          }]
        }
      ]
    }

    const result = normalizeFootnotesDoc(doc)

    expect(result.changed).toBe(true)
    expect(result.doc.content?.[1]).toEqual(standaloneBlock)
    expect(result.doc.content?.[2]?.type).toBe('footnotesBlock')
    expect(result.doc.content?.[2]?.content?.[0]?.content?.[0]).toEqual({
      type: 'listItem',
      attrs: { footnoteId: 'note-a' },
      content: [{
        type: 'paragraph',
        content: [{ type: 'text', text: 'Note body' }]
      }]
    })
  })

  it('does not mutate its input and is idempotent after normalization', () => {
    const doc: JsonContent = {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [{
          type: 'text',
          text: '1',
          marks: [{ type: 'footnote', attrs: { id: 'note-a', index: 1 } }]
        }]
      }]
    }
    const original = JSON.parse(JSON.stringify(doc)) as JsonContent

    const first = normalizeFootnotesDoc(doc)
    const second = normalizeFootnotesDoc(first.doc)

    expect(doc).toEqual(original)
    expect(first.changed).toBe(true)
    expect(second.changed).toBe(false)
    expect(second.doc).toEqual(first.doc)
  })
})
