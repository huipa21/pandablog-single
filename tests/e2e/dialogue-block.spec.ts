import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Editor, JSONContent } from '@tiptap/core'
import sharp from 'sharp'
import { dialogueCharacters, dialogueFixture } from './fixtures/dialogue'

const username = process.env.E2E_ADMIN_USERNAME
const password = process.env.E2E_ADMIN_PASSWORD
const postIds: string[] = []
test.use({ extraHTTPHeaders: { 'x-pandablog-client': 'non-browser' } })
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
type EditorElement = HTMLElement & { editor: Editor }

async function openPost(page: Page, content: JSONContent = { type: 'doc', content: [dialogueFixture(), { type: 'paragraph' }] }) {
  const slug = `dialogue-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const response = await page.request.post('/api/admin/posts', { data: { title: slug, slug, status: 'published', content_json: content } })
  expect(response.status(), await response.text()).toBe(200)
  const { id } = await response.json()
  postIds.push(String(id))
  await page.goto(`/admin/posts/${encodeURIComponent(String(id))}`)
  await expect(page.locator('.ProseMirror')).toBeVisible()
  return slug
}
async function json(page: Page): Promise<JSONContent> {
  return page.locator('.ProseMirror').evaluate((element) => (element as EditorElement).editor.getJSON())
}
async function selectLine(page: Page, index: number, offset = 0) {
  await page.locator('.ProseMirror').evaluate((element, args) => {
    const editor = (element as EditorElement).editor
    const positions: number[] = []
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'dialogueLine') positions.push(pos) })
    editor.chain().focus().setTextSelection(positions[args.index]! + 1 + args.offset).run()
  }, { index, offset })
  await expect(page.locator('.ProseMirror')).toBeFocused()
}
async function lines(page: Page) { return (await json(page)).content?.find((node) => node.type === 'dialogueBlock')?.content ?? [] }

function emptyScene() {
  return { type: 'doc', content: [{ type: 'dialogueBlock', attrs: { characters: dialogueCharacters }, content: [{ type: 'dialogueLine', attrs: { kind: 'speech', characterId: 'maya' } }] }, { type: 'paragraph' }] }
}

test.beforeEach(async ({ context }) => {
  test.skip(!username || !password, 'Set E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD; a running app and database are required.')
  const response = await context.request.post('/api/auth/login', { data: { username, password } })
  expect(response.status(), await response.text()).toBe(200)
})
test.afterEach(async ({ context }) => {
  for (const id of postIds.splice(0)) await context.request.delete(`/api/admin/posts/${encodeURIComponent(id)}`)
})

for (const keyword of ['dialogue', 'roleplay', 'script']) {
  test(`slash ${keyword} inserts two characters and two speech lines`, async ({ page }) => {
    await openPost(page, { type: 'doc', content: [{ type: 'paragraph' }] })
    await page.locator('.ProseMirror p').first().click()
    await page.keyboard.type('/')
    await expect(page.getByTestId('slash-command-menu')).toBeVisible()
    await page.keyboard.type(keyword)
    await page.getByTestId('slash-command-item-dialogueBlock').click()
    const block = (await json(page)).content?.find((node) => node.type === 'dialogueBlock')
    expect(block?.attrs?.characters).toHaveLength(2)
    expect(block?.content).toHaveLength(2)
    expect(block?.content?.map((line) => line.attrs?.kind)).toEqual(['speech', 'speech'])
  })
}

test('keyboard insertion, six-line alternation, Ctrl+Enter, hard break, Backspace and exit', async ({ page }) => {
  await openPost(page, { type: 'doc', content: [{ type: 'paragraph' }] })
  await page.locator('.ProseMirror p').first().click()
  await page.keyboard.press(`${mod}+Shift+d`)
  await expect(page.locator('.dialogue-block')).toBeVisible()
  // Use a one-line scene to make the six Enter sequence unambiguous.
  await page.locator('.ProseMirror').evaluate((element, doc) => (element as EditorElement).editor.commands.setContent(doc), emptyScene())
  await selectLine(page, 0)
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.type(`Line ${index + 1}`)
    if (index < 5) await page.keyboard.press('Enter')
  }
  expect((await lines(page)).map((line) => line.attrs?.characterId)).toEqual(['maya', 'alex', 'maya', 'alex', 'maya', 'alex'])
  await page.keyboard.press(`${mod}+Enter`)
  expect((await lines(page))[6]?.attrs?.characterId).toBe('maya')
  await page.keyboard.type('Next speaker')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('Second visual line')
  expect((await lines(page))[6]?.content?.some((node) => node.type === 'hardBreak')).toBe(true)
  await page.keyboard.press(`${mod}+Shift+d`)
  expect(await lines(page)).toHaveLength(8)
  await page.keyboard.press('Backspace')
  expect(await lines(page)).toHaveLength(7)
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  expect(await lines(page)).toHaveLength(7)
  const selectionType = await page.locator('.ProseMirror').evaluate((element) => (element as EditorElement).editor.state.selection.$from.parent.type.name)
  expect(selectionType).toBe('paragraph')
})

test('Backspace never removes the only empty line; prefix conversion undo restores typed text', async ({ page }) => {
  await openPost(page, emptyScene())
  await selectLine(page, 0)
  await page.keyboard.press('Backspace')
  expect(await lines(page)).toHaveLength(1)
  await page.keyboard.type('John: ')
  await expect(page.locator('.dialogue-speaker-name').first()).toHaveText('John')
  expect((await lines(page))[0]?.content ?? []).toEqual([])
  await page.keyboard.press(`${mod}+z`)
  await expect(page.locator('.dialogue-text').first()).toHaveText('John: ')
  await page.keyboard.type('Hello')
})

test('plain-text multiline paste converts scripts; single-line paste is left alone', async ({ page }) => {
  await openPost(page, emptyScene())
  await selectLine(page, 0)
  await page.locator('.ProseMirror').evaluate((element) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', 'Maya: Hello\n\nAlex：Hi\nJohn (thought): Why?\nThe door opens.')
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  })
  const result = await lines(page)
  expect(result).toHaveLength(4)
  expect(result.map((line) => line.attrs?.kind)).toEqual(['speech', 'speech', 'thought', 'narration'])
  expect(result.map((line) => line.content?.[0]?.text)).toEqual(['Hello', 'Hi', 'Why?', 'The door opens.'])
  expect((await json(page)).content?.[0]?.attrs?.characters.some((character: { name: string }) => character.name === 'John')).toBe(true)
  await page.keyboard.press(`${mod}+z`)
  expect(await lines(page)).toHaveLength(1)
  await selectLine(page, 0)
  await page.locator('.ProseMirror').evaluate((element) => {
    const clipboardData = new DataTransfer()
    clipboardData.setData('text/plain', 'Zoe: one line')
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }))
  })
  expect((await lines(page))[0]?.content?.[0]?.text).toBe('Zoe: one line')
  expect((await json(page)).content?.[0]?.attrs?.characters).toHaveLength(2)
})

test('selected paragraph conversion is available in the toolbar and undoable', async ({ page }) => {
  const doc = { type: 'doc', content: ['Maya: Hello', 'Alex：Hi'].map((text) => ({ type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'bold' }] }] })) }
  await openPost(page, doc)
  await page.locator('.ProseMirror').evaluate((element) => {
    const editor = (element as EditorElement).editor
    editor.chain().focus().setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 }).run()
  })
  const toolbar = page.getByTestId('block-popup-toolbar')
  const expand = toolbar.getByRole('button', { name: 'Expand toolbar' })
  if (await expand.isVisible()) await expand.click()
  await toolbar.getByTitle('Transform to...').click()
  await page.getByRole('menuitem').filter({ hasText: 'Convert paragraphs to dialogue' }).click()
  expect((await lines(page)).map((line) => line.content?.[0]?.text)).toEqual(['Hello', 'Hi'])
  await expect(page.locator('.dialogue-text strong').first()).toHaveText('Hello')
  await page.keyboard.press(`${mod}+z`)
  await expect(page.locator('.ProseMirror p').first()).toHaveText('Maya: Hello')
})

test('character picker search, keyboard selection, Esc and creation; settings rename and confirmed delete', async ({ page }) => {
  await openPost(page)
  await selectLine(page, 0)
  await page.locator('.dialogue-speaker').first().click()
  const picker = page.getByTestId('dialogue-character-picker')
  await expect(picker).toBeVisible()
  const search = picker.getByRole('combobox')
  await search.fill('Alex')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('Enter')
  await expect(page.locator('.dialogue-speaker-name').first()).toHaveText('Alex')
  await page.locator('.dialogue-speaker').first().click()
  await expect(picker).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(picker).toBeHidden()
  await page.keyboard.type('Focused')
  await expect(page.locator('.dialogue-text').first()).toContainText('Focused')
  await page.locator('.dialogue-speaker').first().click()
  await picker.getByRole('combobox').fill('John')
  await picker.getByRole('option', { name: '+ New character: John' }).click()
  await expect(page.locator('.dialogue-speaker-name').first()).toHaveText('John')
  const settings = page.getByTestId('dialogue-settings')
  await expect(settings).toBeVisible()
  const john = settings.getByTestId('dialogue-character-settings').last()
  const nameInput = john.getByRole('textbox', { name: 'Character name', exact: true })
  await nameInput.fill('Jonathan')
  await nameInput.press('Tab')
  await expect(page.locator('.dialogue-speaker-name').first()).toHaveText('Jonathan')
  await john.getByRole('button', { name: 'Delete character', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Lines become narration')
  await page.getByRole('dialog').getByRole('button', { name: 'Delete character', exact: true }).click()
  await expect(page.locator('.dialogue-line').first()).toHaveAttribute('data-kind', 'narration')
})

test('line menu offers switching, duplicate, reorder and delete dialogue; actions are undoable', async ({ page }) => {
  await openPost(page)
  await selectLine(page, 0)
  async function menu(index: number, label: string) {
    await selectLine(page, index)
    await page.locator('.dialogue-line').nth(index).getByRole('button', { name: 'Line actions' }).click()
    await expect(page.getByRole('menuitem')).toHaveText(['Switch to narration', 'Duplicate line', 'Move up', 'Move down', 'Delete dialogue'])
    await page.getByRole('menuitem', { name: label, exact: true }).click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(page.locator('.ProseMirror')).toBeFocused()
  }
  await menu(0, 'Duplicate line')
  expect(await lines(page)).toHaveLength(5)
  await page.keyboard.press(`${mod}+z`)
  expect(await lines(page)).toHaveLength(4)
  await menu(0, 'Move down')
  expect((await lines(page))[0]?.attrs?.characterId).toBe('alex')
  await menu(1, 'Move up')
  expect((await lines(page))[0]?.attrs?.characterId).toBe('maya')
  await menu(0, 'Delete dialogue')
  expect(await lines(page)).toHaveLength(3)
  await page.keyboard.press(`${mod}+z`)
  expect(await lines(page)).toHaveLength(4)
})

test('only the trailing plus adds dialogue or narration', async ({ page }) => {
  await openPost(page)
  const block = page.locator('.dialogue-block')
  await block.hover()
  await expect(block.locator('.dialogue-block-chrome, .dialogue-block-footer')).toHaveCount(0)
  const plus = block.getByRole('button', { name: 'Add dialogue or narration', exact: true })
  const lastLine = block.locator('.dialogue-line').last()
  const plusBox = await plus.boundingBox()
  const lineBox = await lastLine.boundingBox()
  const blockBox = await block.boundingBox()
  expect(plusBox!.y).toBeGreaterThanOrEqual(lineBox!.y + lineBox!.height)
  expect(plusBox!.x).toBeCloseTo(blockBox!.x, 0)
  await plus.click()
  await expect(page.getByRole('menuitem')).toHaveText(['Dialogue', 'Narration'])
  await page.getByRole('menuitem', { name: 'Narration', exact: true }).click()
  await expect(block.locator('.dialogue-line')).toHaveCount(5)
  await expect(page.locator('.ProseMirror')).toBeFocused()
  expect(await lines(page)).toHaveLength(5)
  expect((await lines(page))[4]?.attrs).toMatchObject({ kind: 'narration', characterId: null })
  await page.keyboard.type('The door opens.')
  await expect(block.locator('.dialogue-text').last()).toHaveText('The door opens.')
  await plus.click()
  await page.getByRole('menuitem', { name: 'Dialogue', exact: true }).click()
  await expect(block.locator('.dialogue-line')).toHaveCount(6)
  await expect(page.locator('.ProseMirror')).toBeFocused()
  expect(await lines(page)).toHaveLength(6)
  expect((await lines(page))[5]?.attrs?.kind).toBe('speech')
  await expect(block.locator('.dialogue-line-kind')).toHaveCount(0)
  await page.keyboard.type('Hello')
  await expect(block.locator('.dialogue-text').last()).toHaveText('Hello')
  await page.keyboard.press('Enter')
  await expect(block.locator('.dialogue-line')).toHaveCount(7)
  await expect(block.locator('.dialogue-line-kind')).toHaveCount(0)
  await page.keyboard.press(`${mod}+Enter`)
  expect(await lines(page)).toHaveLength(6)
  const selectionType = await page.locator('.ProseMirror').evaluate((element) => (element as EditorElement).editor.state.selection.$from.parent.type.name)
  expect(selectionType).toBe('paragraph')
})

for (const style of ['compact', 'accent', 'avatar'] as const) {
  test(`${style}: editor/public metrics and inline markup match at 360/768/1024/1440`, async ({ page }) => {
    const fixture = dialogueFixture(style)
    fixture.content![0]!.content!.push(
      { type: 'rubyUnit', attrs: { base: '你', reading: 'nǐ', lang: 'cmn' } },
      { type: 'text', text: '1', marks: [{ type: 'footnote', attrs: { id: 'dialogue-note', index: 1 } }] }
    )
    const slug = await openPost(page, { type: 'doc', content: [fixture, { type: 'footnotesBlock', content: [{ type: 'orderedList', content: [{ type: 'listItem', attrs: { footnoteId: 'dialogue-note' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Dialogue note' }] }] }] }] }] })
    const publicPage = await page.context().newPage()
    await publicPage.goto(`/blog/${slug}`)
    await expect(publicPage.locator('.dialogue-block')).toBeVisible()
    for (const width of [360, 768, 1024, 1440]) {
      for (const surface of [page, publicPage]) {
        await surface.setViewportSize({ width, height: 1000 })
        const block = surface.locator('.dialogue-block')
        await expect(block).toHaveAttribute('data-style', style)
        if (surface === page) await expect(block.locator('input.dialogue-block-title')).toHaveValue('The hallway')
        else await expect(block.locator('.dialogue-block-title')).toHaveText('The hallway')
        const speaker = block.locator('.dialogue-speaker-name').first()
        await expect(speaker).toHaveAttribute('title', dialogueCharacters[0]!.name)
        await expect(speaker).toHaveCSS('text-overflow', 'ellipsis')
        await expect(block.locator('.dialogue-text strong').first()).toHaveText('Are you sure ')
        await expect(block.locator('.dialogue-text a[href="https://example.com"]').first()).toBeVisible()
        await expect(block.locator('.ruby-unit rt')).toHaveText('nǐ')
        await expect(block.locator('.footnote-ref')).toBeVisible()
        await expect(block.locator('[data-kind="narration"] .dialogue-text')).toHaveCSS('font-style', 'italic')
        await expect(block.locator('[data-kind="thought"] .dialogue-thought-label')).toContainText('thought')
        const layout = await block.locator('.dialogue-line').first().evaluate((element) => {
          const speaker = element.querySelector('.dialogue-speaker')!.getBoundingClientRect()
          const text = element.querySelector('.dialogue-text')!.getBoundingClientRect()
          return { speakerWidth: speaker.width, speakerTop: speaker.top, textTop: text.top, textLeft: text.left, speakerLeft: speaker.left }
        })
        if (width === 360) {
          expect(layout.textTop).toBeGreaterThan(layout.speakerTop)
          expect(Math.abs(layout.textLeft - layout.speakerLeft)).toBeLessThan(1)
        } else {
          expect(layout.speakerWidth).toBeCloseTo(120, 0)
          const alignment = await block.locator('.dialogue-line').first().evaluate((element) => {
            const name = element.querySelector('.dialogue-speaker-name')!
            const text = element.querySelector('.dialogue-text')!
            const glyphTop = (node: Element) => {
              const first = document.createTreeWalker(node, NodeFilter.SHOW_TEXT).nextNode()!
              const range = document.createRange()
              range.setStart(first, 0)
              range.setEnd(first, 1)
              return range.getBoundingClientRect().top
            }
            return { nameTop: glyphTop(name), textTop: glyphTop(text), nameSize: getComputedStyle(name).fontSize, textSize: getComputedStyle(text).fontSize }
          })
          expect(alignment.nameSize).toBe(alignment.textSize)
          expect(Math.abs(alignment.nameTop - alignment.textTop)).toBeLessThan(1)
        }
        expect(await surface.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true)
      }
      const metrics = async (surface: Page) => surface.locator('.dialogue-text').first().evaluate((element) => {
        const style = getComputedStyle(element)
        return { fontSize: style.fontSize, lineHeight: style.lineHeight, fontStyle: style.fontStyle, overflowWrap: style.overflowWrap }
      })
      expect(await metrics(page)).toEqual(await metrics(publicPage))
    }
    if (style === 'avatar') {
      await expect(page.locator('.dialogue-avatar').first()).toContainText('MW')
      await expect(publicPage.locator('.dialogue-avatar').first()).toContainText('MW')
    }
    await publicPage.close()
  })
}

test('media-library avatar renders on both surfaces and clearing returns to initials', async ({ page }) => {
  const image = await sharp({ create: { width: 24, height: 24, channels: 4, background: { r: Date.now() % 256, g: 90, b: 120, alpha: 1 } } }).png().toBuffer()
  const response = await page.request.post('/api/media/upload', { multipart: { files: { name: `dialogue-avatar-${Date.now()}.png`, mimeType: 'image/png', buffer: image } } })
  expect(response.status(), await response.text()).toBe(200)
  const upload = (await response.json()).results[0]
  expect(['created', 'duplicate']).toContain(upload.status)
  const media = upload.record
  expect(media?.hash).toBeTruthy()
  try {
    const fixture = dialogueFixture('avatar')
    fixture.attrs!.characters = dialogueCharacters.map((character, index) => index ? character : { ...character, avatarMediaId: String(media.id), avatarSrc: `/media/${media.hash}` })
    const slug = await openPost(page, { type: 'doc', content: [fixture, { type: 'paragraph' }] })
    const avatar = page.locator('.dialogue-line .dialogue-avatar img').first()
    await expect(avatar).toBeVisible()
    expect(await avatar.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
    const publicPage = await page.context().newPage()
    await publicPage.goto(`/blog/${slug}`)
    await expect(publicPage.locator('.dialogue-avatar img').first()).toHaveAttribute('src', await avatar.getAttribute('src') ?? '')
    await selectLine(page, 0)
    await page.getByTestId('dialogue-character-settings').first().getByRole('button', { name: 'Character colour and avatar' }).click()
    await page.getByTestId('dialogue-character-appearance').getByRole('button', { name: 'Clear avatar' }).click()
    await expect(page.locator('.dialogue-line .dialogue-avatar img')).toHaveCount(0)
    await expect(page.locator('.dialogue-line .dialogue-avatar').first()).toHaveText('MW')
    await publicPage.close()
  } finally {
    // Never delete a deduplicated fixture that may belong to another post.
    for (const id of postIds.splice(0)) await page.request.delete(`/api/admin/posts/${encodeURIComponent(id)}`)
    if (upload.status === 'created') await page.request.delete(`/api/media/${encodeURIComponent(String(media.id))}`)
  }
})

test('empty public title is hidden; editor placeholder is only shown in the active block', async ({ page }) => {
  const fixture = dialogueFixture()
  fixture.attrs!.title = ''
  const slug = await openPost(page, { type: 'doc', content: [fixture, { type: 'paragraph' }] })
  await selectLine(page, 0)
  await expect(page.getByPlaceholder('Scene title (optional)')).toBeVisible()
  await page.locator('.ProseMirror p').last().click()
  await expect(page.getByPlaceholder('Scene title (optional)')).toBeHidden()
  await page.goto(`/blog/${slug}`)
  await expect(page.locator('.dialogue-block')).toBeVisible()
  await expect(page.locator('.dialogue-block-title')).toHaveCount(0)
})
