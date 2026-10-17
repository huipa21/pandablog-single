import { ListItem } from '@tiptap/extension-list'

export const ListItemEnhanced = ListItem.extend({
  addAttributes() {
    const parent = this.parent?.() ?? {}

    return {
      ...parent,
      footnoteId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-footnote-id'),
        renderHTML: (attributes: Record<string, unknown>) => {
          const footnoteId = typeof attributes.footnoteId === 'string' ? attributes.footnoteId.trim() : ''
          return footnoteId ? { 'data-footnote-id': footnoteId } : {}
        }
      }
    }
  }
})
