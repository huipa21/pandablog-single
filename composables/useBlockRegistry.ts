import type { JsonContent } from '~/types/content'
import {
  DEFAULT_DIFF_NEW_LABEL,
  DEFAULT_DIFF_OLD_LABEL,
} from '~/utils/diffBlock'
import { DEFAULT_BLOCK_MATH_ALIGN } from '~/extensions/blockMath'
import { normalizeBlockPresentation } from '~/utils/blockPresentation'
import { DEFAULT_ANNOT_LANG } from '~/extensions/rubyUnit'
import { createDialogueContent } from '~/extensions/dialogueBlock'

export type BlockCategory = 'text' | 'media' | 'design' | 'embed' | 'advanced'

export interface BlockDefinition {
  name: string
  title: string
  description: string
  icon: string
  category: BlockCategory
  keywords: string[]
  implemented: boolean
  hidden?: boolean
  supports: {
    align?: boolean
    color?: boolean
    typography?: boolean
    spacing?: boolean
    border?: boolean
  }
  createContent?: () => JsonContent
}

const blockCategories: Array<{ value: BlockCategory, label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'media', label: 'Media' },
  { value: 'design', label: 'Design' },
  { value: 'embed', label: 'Embeds' },
  { value: 'advanced', label: 'Advanced' }
]

const blockDefinitions: BlockDefinition[] = [
  {
    name: 'paragraph',
    title: 'Paragraph',
    description: 'Start with basic text.',
    icon: 'i-lucide-pilcrow',
    category: 'text',
    keywords: ['text', 'copy', 'body'],
    implemented: true,
    supports: { align: true, color: true, typography: true, spacing: true },
    createContent: () => ({ type: 'paragraph' })
  },
  {
    name: 'heading',
    title: 'Heading',
    description: 'Introduce a new section.',
    icon: 'i-lucide-heading',
    category: 'text',
    keywords: ['title', 'subtitle', 'h1', 'h2', 'h3'],
    implemented: true,
    supports: { align: true, color: true, typography: true, spacing: true },
    createContent: () => ({ type: 'heading', attrs: { level: 2 } })
  },
  {
    name: 'bulletList',
    title: 'Bullet List',
    description: 'Create an unordered list.',
    icon: 'i-lucide-list',
    category: 'text',
    keywords: ['ul', 'list', 'bullets'],
    implemented: true,
    supports: { spacing: true },
    createContent: () => ({
      type: 'bulletList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }]
    })
  },
  {
    name: 'orderedList',
    title: 'Numbered List',
    description: 'Create an ordered list.',
    icon: 'i-lucide-list-ordered',
    category: 'text',
    keywords: ['ol', 'list', 'numbers'],
    implemented: true,
    supports: { spacing: true },
    createContent: () => ({
      type: 'orderedList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }]
    })
  },
  {
    name: 'blockquote',
    title: 'Quote',
    description: 'Highlight quoted text.',
    icon: 'i-lucide-quote',
    category: 'text',
    keywords: ['quote', 'citation'],
    implemented: true,
    supports: { color: true, spacing: true, border: true },
    createContent: () => ({
      type: 'blockquote',
      attrs: { style: 'bar', authorName: '', authorTitle: '' },
      content: [{ type: 'paragraph' }]
    })
  },
  {
    name: 'image',
    title: 'Image',
    description: 'Upload or insert an image.',
    icon: 'i-lucide-image-plus',
    category: 'media',
    keywords: ['photo', 'media', 'upload'],
    implemented: true,
    supports: { align: true, spacing: true, border: true },
    createContent: () => ({
      type: 'image',
      attrs: {
        src: '', alt: '', title: '', titlePosition: 'bottom',
        sizePreset: 'full', naturalWidth: null, naturalHeight: null, align: 'center'
      }
    })
  },
  {
    name: 'mediaText',
    title: 'Media & Text',
    description: 'Place media beside written content.',
    icon: 'i-lucide-panel-left',
    category: 'media',
    keywords: ['columns', 'image', 'text'],
    implemented: true,
    supports: { spacing: true },
    createContent: () => ({
      type: 'mediaText',
      attrs: {
        mediaSrc: '', mediaAlt: '', mediaTitle: '', mediaTitlePosition: 'bottom',
        mediaSizePreset: 'full', blockWidth: 'content',
        mediaNaturalWidth: null, mediaNaturalHeight: null,
        mediaPosition: 'left', layoutPreset: 'equal'
      },
      content: [{ type: 'paragraph' }]
    })
  },
  {
    name: 'filesBlock',
    title: 'Files',
    description: 'Attach downloadable media files.',
    icon: 'i-lucide-files',
    category: 'media',
    keywords: ['files', 'attachments', 'documents', 'downloads', 'media'],
    implemented: true,
    supports: { spacing: true },
    createContent: () => ({
      type: 'filesBlock',
      attrs: {
        files: [],
        blockWidth: 'content'
      }
    })
  },
  {
    name: 'columnsBlock',
    title: 'Columns',
    description: 'Arrange blocks in up to six responsive columns.',
    icon: 'i-lucide-columns-3',
    category: 'design',
    keywords: ['columns', 'layout', 'grid', 'two column', 'three column'],
    implemented: true,
    supports: { spacing: true },
    createContent: () => ({
      type: 'columnsBlock',
      attrs: {
        columns: 2,
        layoutPreset: 'equal', showHeaders: true, blockWidth: 'content'
      },
      content: [
        { type: 'columnItem', attrs: { header: '' }, content: [{ type: 'paragraph' }] },
        { type: 'columnItem', attrs: { header: '' }, content: [{ type: 'paragraph' }] }
      ]
    })
  },
  {
    name: 'tabsBlock',
    title: 'Tabs',
    description: 'Group blocks into switchable tab panels.',
    icon: 'i-lucide-panel-top',
    category: 'design',
    keywords: ['tabs', 'panel', 'accordion', 'switcher'],
    implemented: true,
    supports: { spacing: true },
    createContent: () => ({
      type: 'tabsBlock',
      attrs: { orientation: 'horizontal', blockWidth: 'content', activeIndex: 0 },
      content: [
        { type: 'tabPanel', attrs: { title: '' }, content: [{ type: 'paragraph' }] },
        { type: 'tabPanel', attrs: { title: '' }, content: [{ type: 'paragraph' }] }
      ]
    })
  },
  {
    name: 'accordionBlock',
    title: 'Accordion',
    description: 'Toggle blocks of content with collapsible panes.',
    icon: 'i-lucide-chevrons-up-down',
    category: 'design',
    keywords: ['accordion', 'collapse', 'expand', 'faq', 'panes', 'disclosure'],
    implemented: true,
    supports: { spacing: true },
    createContent: () => ({
      type: 'accordionBlock',
      attrs: {
        singleOpen: true,
        startCollapsed: false,
        columns: 1,
        defaultOpenIndices: [0], blockWidth: 'content'
      },
      content: [
        { type: 'accordionPane', attrs: { title: 'Accordion Pane 1', defaultOpen: true }, content: [{ type: 'paragraph' }] },
        { type: 'accordionPane', attrs: { title: 'Accordion Pane 2', defaultOpen: false }, content: [{ type: 'paragraph' }] }
      ]
    })
  },
  {
    name: 'dialogueBlock',
    title: 'Dialogue',
    description: 'Write a scene with speakers, narration and thoughts.',
    icon: 'i-lucide-message-square-quote',
    category: 'text',
    keywords: ['dialogue', 'roleplay', 'script', 'scene', 'conversation', 'chat'],
    implemented: true,
    supports: { spacing: true },
    createContent: createDialogueContent
  },
  {
    name: 'table',
    title: 'Table',
    description: 'Insert a table with editable rows and columns.',
    icon: 'i-lucide-table',
    category: 'text',
    keywords: ['grid', 'rows', 'columns'],
    implemented: true,
    supports: { spacing: true, border: true }
  },
  {
    name: 'codeBlock',
    title: 'Code',
    description: 'Show highlighted code with a language.',
    icon: 'i-lucide-square-code',
    category: 'advanced',
    keywords: ['pre', 'snippet', 'programming'],
    implemented: true,
    supports: { spacing: true },
    createContent: () => ({
      type: 'codeBlock',
      attrs: { language: 'javascript', lineNumbers: true, lineHighlights: '', wrap: true, collapsed: true },
      content: []
    })
  },
  {
    name: 'diffBlock',
    title: 'Diff',
    description: 'Compare two versions line by line.',
    icon: 'i-lucide-git-compare-arrows',
    category: 'advanced',
    keywords: ['diff', 'compare', 'before', 'after', 'config'],
    implemented: true,
    supports: { spacing: true },
    createContent: () => ({
      type: 'diffBlock',
      attrs: {
        oldText: '',
        newText: '',
        language: 'plaintext',
        oldLabel: DEFAULT_DIFF_OLD_LABEL,
        newLabel: DEFAULT_DIFF_NEW_LABEL
      }
    })
  },
  {
    name: 'mermaid',
    title: 'Mermaid',
    description: 'Create a diagram from Mermaid syntax.',
    icon: 'i-lucide-git-fork',
    category: 'advanced',
    keywords: ['diagram', 'flowchart', 'graph'],
    implemented: true,
    supports: { spacing: true },
    createContent: () => ({
      type: 'mermaid',
      attrs: { code: '' }
    })
  },
  {
    name: 'blockMath',
    title: 'Formula',
    description: 'Render a display math formula with KaTeX.',
    icon: 'i-lucide-sigma',
    category: 'advanced',
    keywords: ['math', 'formula', 'latex', 'equation', 'science', 'katex'],
    implemented: true,
    supports: { spacing: true },
    createContent: () => ({
      type: 'blockMath',
      attrs: {
        latex: '',
        align: DEFAULT_BLOCK_MATH_ALIGN
      }
    })
  },
  {
    name: 'horizontalRule',
    title: 'Separator',
    description: 'Add a visual divider.',
    icon: 'i-lucide-minus',
    category: 'design',
    keywords: ['divider', 'rule', 'line'],
    implemented: true,
    supports: { spacing: true },
    createContent: () => ({
      type: 'horizontalRule',
      attrs: { styleType: 'solid' }
    })
  },
  {
    name: 'footnotesBlock',
    title: 'Footnotes',
    description: 'Footnote lines linked to inline references.',
    icon: 'i-lucide-footprints',
    category: 'text',
    keywords: ['footnote', 'reference', 'notes'],
    implemented: true,
    hidden: true,
    supports: { spacing: true }
  },
  {
    name: 'embed',
    title: 'Embed',
    description: 'Embed a YouTube video from a URL.',
    icon: 'i-lucide-globe-2',
    category: 'embed',
    keywords: ['url', 'youtube', 'video'],
    implemented: true,
    supports: { align: true, spacing: true },
    createContent: () => ({
      type: 'videoEmbed',
      attrs: { provider: 'youtube', videoId: '', start: 0 }
    })
  },
  {
    name: 'postEmbed',
    title: 'Post',
    description: 'Embed another post as a linked card or inline chip.',
    icon: 'i-lucide-newspaper',
    category: 'embed',
    keywords: ['post', 'embed', 'reference', 'link', 'related', 'card'],
    implemented: true,
    supports: { spacing: true },
    createContent: () => ({
      type: 'postEmbed',
      attrs: {
        postId: '', slug: '', title: '',
        customLabel: '', blockWidth: 'content', showCover: true
      }
    })
  },
  {
    name: 'customHtml',
    title: 'Custom HTML',
    description: 'Write raw HTML with a preview.',
    icon: 'i-lucide-file-code-2',
    category: 'advanced',
    keywords: ['html', 'markup'],
    implemented: true,
    supports: { spacing: true },
    createContent: () => ({
      type: 'customHtml',
      attrs: { html: '' }
    })
  },
  {
    name: 'annotationBlock',
    title: 'Annotation',
    description: 'Annotate text with phonetic readings (pinyin, jyutping, furigana).',
    icon: 'i-lucide-languages',
    category: 'text',
    keywords: ['annotation', 'ruby', 'pinyin', 'jyutping', 'furigana', 'cmn', 'yue', 'jpn', 'reading'],
    implemented: true,
    supports: { spacing: true },
    createContent: () => ({
      type: 'annotationBlock',
      attrs: { lang: DEFAULT_ANNOT_LANG }
    })
  }
]

const enabledBlockDefinitions = blockDefinitions.map(block => ({
  ...block,
  supports: Object.fromEntries(Object.entries(block.supports).filter(([key]) => key !== 'spacing')),
  createContent: block.createContent ? () => normalizeBlockPresentation(block.createContent!()) : undefined
}))
const visibleBlockDefinitions = enabledBlockDefinitions.filter((block) => !block.hidden)

const normalizedBlocks = visibleBlockDefinitions.map((block) => ({
  ...block,
  searchText: [block.title, block.description, block.name, ...block.keywords]
    .join(' ')
    .toLowerCase()
}))

export function useBlockRegistry() {
  function getBlockDefinition(name: string) {
    return enabledBlockDefinitions.find((block) => block.name === name) ?? null
  }

  function getBlocksByCategory(category: BlockCategory) {
    return visibleBlockDefinitions.filter((block) => block.category === category)
  }

  function searchBlocks(query: string) {
    const normalizedQuery = query.trim().toLowerCase()

    if (!normalizedQuery) {
      return visibleBlockDefinitions
    }

    return normalizedBlocks
      .filter((block) => block.searchText.includes(normalizedQuery))
      .map(({ searchText: _searchText, ...block }) => block)
  }

  const { t } = useI18n()
  const localize = (block: BlockDefinition) => block.name === 'dialogueBlock'
    ? { ...block, title: t('admin.editor.dialogue.title'), description: t('admin.editor.dialogue.description'), createContent: () => createDialogueContent([t('admin.editor.dialogue.characterA'), t('admin.editor.dialogue.characterB')]) }
    : block

  return {
    categories: blockCategories,
    blocks: visibleBlockDefinitions.map(localize),
    getBlockDefinition: (name: string) => { const block = getBlockDefinition(name); return block ? localize(block) : null },
    getBlocksByCategory: (category: BlockCategory) => getBlocksByCategory(category).map(localize),
    searchBlocks: (query: string) => searchBlocks(query).map(localize)
  }
}