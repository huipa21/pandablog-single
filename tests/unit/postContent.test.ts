import { describe, expect, it } from 'vitest'
import { hasMeaningfulDocContent, hasMeaningfulPostContent } from '../../utils/postContent'
import type { JsonContent } from '../../types/content'

const emptyDoc: JsonContent = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [] }]
}

describe('hasMeaningfulPostContent', () => {
  it('treats a blank title and empty document as empty', () => {
    expect(hasMeaningfulPostContent('', emptyDoc)).toBe(false)
    expect(hasMeaningfulPostContent(null, null)).toBe(false)
  })

  it('treats whitespace and newlines only as empty', () => {
    const whitespaceDoc: JsonContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '   ' }] },
        { type: 'paragraph', content: [{ type: 'hardBreak' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '\n\t  ' }] }
      ]
    }

    expect(hasMeaningfulPostContent(' \n\t ', whitespaceDoc)).toBe(false)
  })

  it('counts a non-blank title', () => {
    expect(hasMeaningfulPostContent('Hello', emptyDoc)).toBe(true)
  })

  it('counts meaningful document content', () => {
    const doc: JsonContent = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }]
    }

    expect(hasMeaningfulPostContent('', doc)).toBe(true)
  })

  it('counts non-text blocks such as images', () => {
    const doc: JsonContent = {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: '/uploads/image.png' } }]
    }

    expect(hasMeaningfulDocContent(doc)).toBe(true)
  })
})
