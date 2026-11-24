import { mergeAttributes, Node } from '@tiptap/core'
import { parseSenseIdsAttribute } from '~/utils/words'

/**
 * Block-level vocabulary card. The post stores only the word anchor and the
 * selected sense ids; definitions live in the `word` table and are resolved at
 * render time. `headword` is a display fallback for deleted/archived words.
 */
export const WordCardNode = Node.create({
  name: 'wordCard',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      wordId: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-word-id') || '',
        renderHTML: (attributes: Record<string, unknown>) => ({ 'data-word-id': attributes.wordId || '' })
      },
      headword: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-headword') || '',
        renderHTML: (attributes: Record<string, unknown>) => ({ 'data-headword': attributes.headword || '' })
      },
      senseIds: {
        default: [],
        parseHTML: (element: HTMLElement) => parseSenseIdsAttribute(element.getAttribute('data-sense-ids')),
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-sense-ids': JSON.stringify(parseSenseIdsAttribute(attributes.senseIds))
        })
      },
      targetLanguage: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-target-language') || '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-target-language': attributes.targetLanguage || ''
        })
      },
      blockWidth: {
        default: 'content',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-block-width') || 'content',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-block-width': attributes.blockWidth || 'content'
        })
      }
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-type="word-card"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'word-card', class: 'word-card-nodeview' })]
  }
})
