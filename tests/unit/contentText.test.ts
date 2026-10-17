import { describe, expect, it } from 'vitest'
import { flattenContentText } from '../../utils/contentText'
import type { JsonContent } from '../../types/content'

describe('flattenContentText', () => {
  it('returns text nodes directly', () => {
    expect(flattenContentText({ type: 'text', text: 'heading' })).toBe('heading')
  })

  it('joins nested child text with spaces', () => {
    const node: JsonContent = {
      type: 'heading',
      content: [
        { type: 'text', text: 'Nested' },
        {
          type: 'link',
          content: [{ type: 'text', text: 'content' }]
        }
      ]
    }

    expect(flattenContentText(node)).toBe('Nested content')
  })

  it('returns an empty string for nodes without text content', () => {
    expect(flattenContentText({ type: 'image' })).toBe('')
  })
})
