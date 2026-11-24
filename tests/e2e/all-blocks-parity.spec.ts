import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { dialogueFixture } from './fixtures/dialogue'

/**
 * WYSIWYG contract test.
 *
 * For every supported block type, the rendered DOM in the admin editor must use the
 * SAME root class name (and equivalent inner chrome) as the public renderer. Editor-only
 * chrome (drag handles, settings, NodeViewWrapper) is allowed in addition, but the
 * visible block element itself must match 1:1.
 *
 * If you add a new block type you MUST extend `BLOCKS` below — that is the rule of thumb:
 * "what you see in the editor is what you see on the published post".
 */

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3000'
const username = process.env.E2E_ADMIN_USERNAME
const password = process.env.E2E_ADMIN_PASSWORD

type BlockExpectation = {
  name: string
  editorSelector: string
  publicSelector: string
}

const BLOCKS: BlockExpectation[] = [
  { name: 'paragraph', editorSelector: '.pb-prose .ProseMirror p:has-text("Paragraph block")', publicSelector: '.pb-prose p:has-text("Paragraph block")' },
  { name: 'heading-h2', editorSelector: '.pb-prose .ProseMirror h2:has-text("Heading two")', publicSelector: '.pb-prose h2:has-text("Heading two")' },
  { name: 'bullet-list', editorSelector: '.pb-prose .ProseMirror ul li:has-text("Bullet item")', publicSelector: '.pb-prose ul li:has-text("Bullet item")' },
  { name: 'ordered-list', editorSelector: '.pb-prose .ProseMirror ol li:has-text("Ordered item")', publicSelector: '.pb-prose ol li:has-text("Ordered item")' },
  { name: 'quote-bar', editorSelector: '.pb-prose .quote-block .quote-bar-row .quote-bar', publicSelector: '.pb-prose .quote-block .quote-bar-row .quote-bar' },
  { name: 'image', editorSelector: '.pb-prose .imageblock-nodeview', publicSelector: '.pb-prose .imageblock-nodeview' },
  { name: 'media-text', editorSelector: '.pb-prose .mediatext-nodeview .media-file-card:has-text("Media attachment.docx")', publicSelector: '.pb-prose .mediatext-nodeview .media-file-card:has-text("Media attachment.docx")' },
  { name: 'files-block', editorSelector: '.pb-prose .files-block .media-file-card:has-text("Directory 260514.docx")', publicSelector: '.pb-prose .files-block .media-file-card:has-text("Directory 260514.docx")' },
  { name: 'columns', editorSelector: '.pb-prose .columns-block .columns-block-column:has-text("Column one body")', publicSelector: '.pb-prose .columns-block .columns-block-column:has-text("Column one body")' },
  { name: 'tabs', editorSelector: '.pb-prose .tabs-block .tabs-block-panel:has-text("First tab panel body")', publicSelector: '.pb-prose .tabs-block .tabs-block-panel:has-text("First tab panel body")' },
  { name: 'dialogue', editorSelector: '.pb-prose .dialogue-block .dialogue-line[data-kind="thought"]', publicSelector: '.pb-prose .dialogue-block .dialogue-line[data-kind="thought"]' },
  { name: 'accordion', editorSelector: '.pb-prose .accordion-block .accordion-pane:has-text("Accordion first pane body")', publicSelector: '.pb-prose .accordion-block .accordion-pane:has-text("Accordion first pane body")' },
  { name: 'table', editorSelector: '.pb-prose .ProseMirror table', publicSelector: '.pb-prose table' },
  { name: 'code', editorSelector: '.pb-prose .codeblock-nodeview', publicSelector: '.pb-prose .codeblock-nodeview' },
  { name: 'diff', editorSelector: '.pb-prose .diff-block .diff-row.is-added:has-text("no shutdown")', publicSelector: '.pb-prose .diff-block .diff-row.is-added:has-text("no shutdown")' },
  { name: 'mermaid', editorSelector: '.pb-prose .mermaid-nodeview .mermaid-preview', publicSelector: '.pb-prose .mermaid-nodeview .mermaid-preview' },
  { name: 'block-math', editorSelector: '.pb-prose .block-math .katex-display', publicSelector: '.pb-prose .block-math .katex-display' },
  { name: 'separator', editorSelector: '.pb-prose .ProseMirror hr', publicSelector: '.pb-prose hr' },
  { name: 'video-embed', editorSelector: '.pb-prose .video-embed-nodeview .video-embed-frame', publicSelector: '.pb-prose .video-embed-nodeview .video-embed-frame' },
  { name: 'customhtml-iframe-preview', editorSelector: '.pb-prose .customhtml-nodeview.is-preview-mode iframe.customhtml-iframe', publicSelector: '.pb-prose .customhtml-block iframe.customhtml-iframe' },
  { name: 'related-post', editorSelector: '.pb-prose .related-post-chip:has-text("Self reference")', publicSelector: '.pb-prose .related-post-chip:has-text("Self reference")' },
  { name: 'footnotes', editorSelector: '.pb-prose .footnotes-block', publicSelector: '.pb-prose .footnotes-block' },
  { name: 'annotation-block', editorSelector: '.pb-prose .annotation-block[data-lang="cmn"]', publicSelector: '.pb-prose .annotation-block[data-lang="cmn"]' },
  { name: 'ruby-unit-inline', editorSelector: '.pb-prose .ruby-unit[data-lang="cmn"] rt:has-text("nǐ")', publicSelector: '.pb-prose .ruby-unit[data-lang="cmn"] rt:has-text("nǐ")' },
  { name: 'inline-math', editorSelector: '.pb-prose .inline-math .katex', publicSelector: '.pb-prose .inline-math .katex' },
  { name: 'word-card', editorSelector: '.pb-prose .pb-word-card:has-text("Terminate")', publicSelector: '.pb-prose .pb-word-card:has-text("Terminate")' }
]

const imageSvg = encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#dff3ed"/>
  <circle cx="185" cy="170" r="72" fill="#0f766e" opacity="0.9"/>
  <rect x="300" y="105" width="220" height="150" rx="18" fill="#134e4a" opacity="0.82"/>
  <text x="320" y="190" font-family="Arial" font-size="34" font-weight="700" fill="#ffffff">PandaBlog</text>
</svg>`)
const imageSrc = `data:image/svg+xml;charset=utf-8,${imageSvg}`

test('all blocks render with matching DOM contract on editor and public surfaces', async ({ browser }) => {
  test.skip(!username || !password, 'Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD to run authenticated tests.')

  const apiContext = await browser.newContext({ baseURL, extraHTTPHeaders: { 'x-pandablog-client': 'non-browser' } })
  const loginResp = await apiContext.request.post('/api/auth/login', {
    data: { username, password }
  })
  expect(loginResp.status(), `login failed: ${await loginResp.text()}`).toBe(200)
  const storage = await apiContext.storageState()
  await apiContext.close()

  const context = await browser.newContext({ baseURL, storageState: storage, extraHTTPHeaders: { 'x-pandablog-client': 'non-browser' } })
  const page = await context.newPage()

  const title = `All Blocks Parity ${Date.now()}`
  const slug = `all-blocks-parity-${Date.now()}`
  const footnoteId = `note-${Date.now()}`

  const wordHeadword = `Terminate ${Date.now()}`
  const wordResp = await context.request.post('/api/admin/words', {
    data: {
      headword: wordHeadword,
      language: 'en',
      pronunciation: '/ˈtɜːmɪneɪt/',
      senses: [{
        partOfSpeech: 'verb',
        definition: 'bring to an end',
        example: 'terminate the contract',
        note: 'formal',
        translations: { 'zh-CN': '终止' }
      }]
    }
  })
  expect(wordResp.status(), `word seed failed: ${await wordResp.text()}`).toBe(200)
  const wordId = String((await wordResp.json()).word?.id ?? '')
  expect(wordId).toBeTruthy()

  const contentJson = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Paragraph block' }, { type: 'text', text: '1', marks: [{ type: 'footnote', attrs: { id: footnoteId, index: 1 } }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Inline formula ' }, { type: 'inlineMath', attrs: { latex: 'E = mc^2' } }, { type: 'text', text: ' inside text.' }] },
      {
        type: 'wordCard',
        attrs: { wordId, headword: wordHeadword, senseIds: [], targetLanguage: 'zh-CN', blockWidth: 'content' }
      },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading two' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Bullet item' }] }] }] },
      { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ordered item' }] }] }] },
      {
        type: 'blockquote',
        attrs: { style: 'bar', theme: '#3e6ae1', fontFamily: 'sans', fontSize: '1rem', fontColor: '#171a20', backgroundColor: '', authorName: 'Author Name', authorTitle: 'Role' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Quote body' }] }]
      },
      {
        type: 'image',
        attrs: { src: imageSrc, alt: 'Generated image', title: 'Image caption', titlePosition: 'bottom', sourceSize: 'full', displaySize: 'fill-container', displayPercent: 100, displayPx: null, width: null, height: null, widthPercent: 100, naturalWidth: 640, naturalHeight: 360, lockAspect: true, align: 'center' }
      },
      {
        type: 'mediaText',
        attrs: {
          mediaSrc: imageSrc,
          mediaAlt: 'Generated media',
          mediaTitle: 'Media caption',
          mediaTitlePosition: 'bottom',
          mediaSourceSize: 'full',
          mediaDisplaySize: 'fill-container',
          mediaDisplayPercent: 100,
          mediaDisplayPx: null,
          blockWidth: 'content',
          mediaWidth: null,
          mediaHeight: null,
          mediaWidthPercent: 100,
          mediaNaturalWidth: 640,
          mediaNaturalHeight: 360,
          lockAspect: true,
          mediaPosition: 'left',
          ratio: 0.42,
          mediaMime: 'image/svg+xml',
          mediaName: 'generated.svg',
          mediaSize: 1024,
          mediaItems: [
            { src: imageSrc, alt: 'Generated media', name: 'generated.svg', mime: 'image/svg+xml', size: 1024, width: 640, height: 360 },
            { src: 'https://example.com/media-attachment.docx', alt: 'Media attachment', name: 'Media attachment.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 985088 }
          ]
        },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Media and text body' }] }]
      },
      {
        type: 'filesBlock',
        attrs: {
          blockWidth: 'content',
          files: [
            { src: 'https://example.com/directory-260514.docx', alt: 'Directory document', name: 'Directory 260514.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 985088 }
          ]
        }
      },
      {
        type: 'columnsBlock',
        attrs: { columns: 3, proportions: '1-2-1', blockWidth: 'content' },
        content: [
          { type: 'columnItem', attrs: { header: 'Column A' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Column one body' }] }] },
          { type: 'columnItem', attrs: { header: 'Column B' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Column two body' }] }] },
          { type: 'columnItem', attrs: { header: 'Column C' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Column three body' }] }] }
        ]
      },
      {
        type: 'tabsBlock',
        attrs: { orientation: 'horizontal', tabStyle: 'pills', blockWidth: 'content', activeIndex: 0 },
        content: [
          { type: 'tabPanel', attrs: { title: 'Overview' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First tab panel body' }] }] },
          { type: 'tabPanel', attrs: { title: 'Details' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second tab panel body' }] }] }
        ]
      },
      {
        type: 'accordionBlock',
        attrs: { singleOpen: true, startCollapsed: false, columns: 1, paneStyle: 'minimal', triggerIcon: 'chevron', defaultOpenIndices: [0], blockWidth: 'content', marginTop: '1rem', marginBottom: '1rem' },
        content: [
          { type: 'accordionPane', attrs: { title: 'Accordion One', defaultOpen: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Accordion first pane body' }] }] },
          { type: 'accordionPane', attrs: { title: 'Accordion Two', defaultOpen: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Accordion second pane body' }] }] }
        ]
      },
      dialogueFixture(),
      buildTable(),
      {
        type: 'codeBlock',
        attrs: { language: 'typescript', theme: 'vs-dark', lineNumbers: true, lineHighlights: '2', wrap: true, zoom: 1, collapsed: true, fileName: 'demo.ts', showTotalLines: true },
        content: [{ type: 'text', text: 'const a = 1\nconst b = 2' }]
      },
      {
        type: 'diffBlock',
        attrs: {
          oldText: 'hostname edge-01\ninterface Ethernet1/1\n  description legacy uplink\n  shutdown',
          newText: 'hostname edge-01\ninterface Ethernet1/1\n  description primary uplink\n  no shutdown',
          language: 'nxos',
          oldLabel: 'Running',
          newLabel: 'Candidate'
        }
      },
      { type: 'mermaid', attrs: { code: 'graph TD;\n  A[Idea] --> B[Connection]' } },
      { type: 'blockMath', attrs: { latex: '\\int_0^1 x^2 \\, dx = \\frac{1}{3}', theme: 'vs-dark', align: 'center', paddingX: 20, paddingY: 18, fontSize: 1.2, fontFamily: 'katex' } },
      { type: 'horizontalRule', attrs: { styleType: 'solid', thickness: 1, marginY: 16, color: '#d6d3d1' } },
      {
        type: 'customHtml',
        attrs: { html: '<div style="padding:8px;background:#eef;color:#003;">Custom HTML widget preview</div>' }
      },
      {
        type: 'videoEmbed',
        attrs: { provider: 'youtube', videoId: 'dQw4w9WgXcQ', start: 0 }
      },
      {
        type: 'annotationBlock',
        attrs: { lang: 'cmn' },
        content: [
          { type: 'rubyUnit', attrs: { base: '你', reading: 'nǐ', lang: 'cmn' } },
          { type: 'rubyUnit', attrs: { base: '好', reading: 'hǎo', lang: 'cmn' } }
        ]
      },
      { type: 'footnotesBlock', content: [{ type: 'orderedList', content: [{ type: 'listItem', attrs: { footnoteId }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Footnote body' }] }] }] }] }
    ]
  }

  const createResp = await context.request.post('/api/admin/posts', {
    data: { title, slug, status: 'published', content_json: contentJson }
  })
  expect(createResp.status(), `create failed: ${await createResp.text()}`).toBe(200)
  const created = await createResp.json()
  const postId = String(created.id ?? '')
  expect(postId).toBeTruthy()

  // Reload the admin editor so it picks up the persisted document.
  await page.goto(`/admin/posts/${encodeURIComponent(postId)}`)
  await page.waitForLoadState('networkidle')
  await page.locator('.ProseMirror').waitFor()
  await expect(page.locator('.pandablog-block-editor.pb-prose .ProseMirror')).toBeVisible()
  const editorFormula = page.locator('.pb-prose .block-math').first()
  await expect(editorFormula.locator('.math-preview-wrap .math-render')).toBeVisible()
  await expect(editorFormula.locator('.math-source-input')).toBeHidden()
  await editorFormula.locator('.math-block-tab:has-text("Source")').click()
  await expect(editorFormula.locator('.math-source-input')).toBeVisible()
  await editorFormula.locator('.math-block-tab:has-text("Preview")').click()

  for (const block of BLOCKS) {
    await expect(
      page.locator(block.editorSelector).first(),
      `editor must render block "${block.name}" via selector ${block.editorSelector}`
    ).toBeVisible()
  }

  await page.goto(`/blog/${slug}`)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('.pb-prose').first()).toBeVisible()

  for (const block of BLOCKS) {
    await expect(
      page.locator(block.publicSelector).first(),
      `public post must render block "${block.name}" via selector ${block.publicSelector}`
    ).toBeVisible()
  }

  for (const viewport of [{ width: 360, height: 900 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(viewport)
    await expect(page.locator('.pb-prose').first()).toBeVisible()
    await expect(page.locator('.pb-prose .mediatext-row').first()).toHaveCSS('flex-direction', 'column')
    await expectNoViewportOverflow(page, `${viewport.width}px public post`)
  }

  const publicVideoEmbed = page.locator('.pb-prose .video-embed-nodeview').first()
  await publicVideoEmbed.locator('.video-embed-facade').click()
  await expect(publicVideoEmbed.locator('iframe.video-embed-iframe')).toHaveAttribute('src', /https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ/)
  await expect(publicVideoEmbed.locator('.video-embed-fallback')).toHaveAttribute('href', /https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ/)

  await context.close()
})

async function expectNoViewportOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => {
    const scrollingElement = document.scrollingElement ?? document.documentElement
    const innerWidth = window.innerWidth
    const offenders = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          selector: describeElement(element),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width)
        }
      })
      .filter((item) => item.right > innerWidth + 1 || item.left < -1)
      .sort((a, b) => b.right - a.right)
      .slice(0, 5)

    return {
      innerWidth,
      scrollWidth: scrollingElement.scrollWidth,
      offenders
    }

    function describeElement(element: HTMLElement) {
      const classes = Array.from(element.classList).slice(0, 3).map((className) => `.${className}`).join('')
      const dataType = element.dataset.type ? `[data-type="${element.dataset.type}"]` : ''
      return `${element.tagName.toLowerCase()}${classes}${dataType}`
    }
  })

  expect(
    metrics.scrollWidth,
    `${label} must not overflow horizontally. Offenders: ${JSON.stringify(metrics.offenders)}`
  ).toBeLessThanOrEqual(metrics.innerWidth + 1)
}

function buildTable() {
  return {
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: ['a1', 'a2', 'a3'].map((text) => ({ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }))
      },
      {
        type: 'tableRow',
        content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'abc', marks: [{ type: 'bold' }] }, { type: 'text', text: 't', marks: [{ type: 'subscript' }] }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'efg', marks: [{ type: 'italic' }] }, { type: 'text', text: '2', marks: [{ type: 'superscript' }] }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'qij' }] }] }
        ]
      },
      {
        type: 'tableRow',
        content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Google', marks: [{ type: 'link', attrs: { href: 'https://www.google.com/', openMode: 'same-tab' } }] }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hh', marks: [{ type: 'code' }] }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'kk', marks: [{ type: 'highlight', attrs: { color: '#ffff00' } }] }] }] }
        ]
      }
    ]
  }
}
