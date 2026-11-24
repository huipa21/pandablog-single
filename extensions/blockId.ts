import { Extension } from '@tiptap/core'

const BLOCK_ID_NODE_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'codeBlock',
  'horizontalRule',
  'table',
  'image',
  'videoEmbed',
  'mediaText',
  'filesBlock',
  'columnsBlock',
  'tabsBlock',
  'accordionBlock',
  'dialogueBlock',
  'customHtml',
  'diffBlock',
  'mermaid',
  'blockMath',
  'annotationBlock',
  'footnotesBlock',
  'wordCard'
]

export const BlockId = Extension.create({
  name: 'blockId',

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_ID_NODE_TYPES,
        attributes: {
          blockId: {
            default: null,
            rendered: false,
            keepOnSplit: false
          }
        }
      }
    ]
  }
})