import { expect, test } from '@playwright/test'
import type { Editor } from '@tiptap/core'
import { dialogueCharacters } from './fixtures/dialogue'
import { DIALOGUE_MAX_CHARACTERS, DIALOGUE_PALETTE } from '../../extensions/dialogueBlock'
import type { MediaRecord } from '../../types/content'

type EditorElement = HTMLElement & { editor: Editor }
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'
const avatarHash = 'd'.repeat(64)
const avatarFixture: MediaRecord = {
  id: `files:${avatarHash}`, hash: avatarHash, original_name: 'dialogue-avatar.png',
  extension: 'png', mime_type: 'image/png', size: 100, is_image: true,
  url: `/media/${avatarHash}`, created_at: '2026-10-07T00:00:00Z'
}

// UI-only coverage: use the real editor/components without credentials or database writes.
// Auth is mocked only in this isolated browser context, not on the application server.
test.beforeEach(async ({ page }) => {
  await page.route(`**/media/${avatarHash}*`, (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="10"/></svg>' }))
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let body: unknown
    if (path === '/api/auth/session') body = { loggedIn: true, user: { id: 'users:admin', username: 'admin' } }
    else if (path === '/api/auth/setup-status') body = { completed: true }
    else if (path === '/api/admin/posts/dialogue-ui-test') body = {
      id: 'dialogue-ui-test', title: 'Dialogue UI test', slug: 'dialogue-ui-test', status: 'draft',
      author_username: 'ui-test', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      content_json: { type: 'doc', content: [{
        type: 'dialogueBlock', attrs: { characters: dialogueCharacters },
        content: [{ type: 'dialogueLine', attrs: { kind: 'speech', characterId: 'maya' }, content: [{ type: 'text', text: 'Hello' }] }]
      }, { type: 'paragraph' }] }
    }
    else if (path === '/api/media/search') body = { files: [avatarFixture], total: 1, pages: 1, page: 1, limit: 20 }
    else if (path === '/api/media/tags') body = { tags: [] }
    else if (path.endsWith('/lock')) body = { can_edit: true, locked: false }
    else if (path.startsWith('/api/admin/')) body = { settings: {}, categories: [], tags: [], versions: [], posts: [] }
    else if (route.request().method() !== 'GET') return route.abort()
    else return route.continue()
    await route.fulfill({ json: body })
  })
  // Login's mounted session check navigates client-side, so browser mocks cover
  // route middleware too. No login request is submitted to the server.
  await page.goto('/login?redirect=/admin/posts/dialogue-ui-test')
  await expect(page.locator('.ProseMirror .dialogue-block')).toBeVisible()
})

async function lines(page: import('@playwright/test').Page) {
  return page.locator('.ProseMirror').evaluate((element) => (element as EditorElement).editor.getJSON().content?.find((node) => node.type === 'dialogueBlock')?.content ?? [])
}
async function selectLine(page: import('@playwright/test').Page, index: number, atEnd = false) {
  await page.locator('.ProseMirror').evaluate((element, { index, atEnd }) => {
    const editor = (element as EditorElement).editor
    const positions: { pos: number, size: number }[] = []
    editor.state.doc.descendants((node, pos) => { if (node.type.name === 'dialogueLine') positions.push({ pos, size: node.content.size }) })
    const line = positions[index]!
    editor.chain().focus().setTextSelection(line.pos + 1 + (atEnd ? line.size : 0)).run()
  }, { index, atEnd })
  await expect(page.locator('.ProseMirror')).toBeFocused()
}

test('only the trailing plus appends dialogue/narration and preserves typing focus', async ({ page }) => {
  const block = page.locator('.dialogue-block')
  await selectLine(page, 0, true)
  await expect(block.locator('.dialogue-block-chrome, .dialogue-block-footer')).toHaveCount(0)
  const plus = block.getByRole('button', { name: 'Add dialogue or narration', exact: true })
  const plusBox = await plus.boundingBox()
  const lineBox = await block.locator('.dialogue-line').last().boundingBox()
  const blockBox = await block.boundingBox()
  expect(plusBox!.y).toBeGreaterThanOrEqual(lineBox!.y + lineBox!.height)
  expect(plusBox!.x).toBeCloseTo(blockBox!.x, 0)
  await plus.click()
  await page.keyboard.press('Escape')
  await expect(plus).toBeFocused()
  expect(await lines(page)).toHaveLength(1)
  await plus.click()
  await expect(page.getByRole('menuitem')).toHaveText(['Dialogue', 'Narration'])
  await page.getByRole('menuitem', { name: 'Narration', exact: true }).click()
  await expect(block.locator('.dialogue-line')).toHaveCount(2)
  await expect(page.locator('.ProseMirror')).toBeFocused()
  expect(await lines(page)).toHaveLength(2)
  expect((await lines(page))[1]?.attrs).toMatchObject({ kind: 'narration', characterId: null })
  await page.keyboard.type('The door opens.')
  await expect(block.locator('.dialogue-text').last()).toHaveText('The door opens.')
  await plus.click()
  await page.getByRole('menuitem', { name: 'Dialogue', exact: true }).click()
  await expect(block.locator('.dialogue-line')).toHaveCount(3)
  await expect(page.locator('.ProseMirror')).toBeFocused()
  expect(await lines(page)).toHaveLength(3)
  expect((await lines(page))[2]?.attrs).toMatchObject({ kind: 'speech', characterId: 'alex' })
  await expect(block.locator('.dialogue-line-kind')).toHaveCount(0)
  await expect(block.getByRole('button', { name: 'Add dialogue or narration', exact: true })).toHaveCount(1)
  await page.keyboard.type('Welcome')
  await expect(block.locator('.dialogue-text').last()).toHaveText('Welcome')
  await page.keyboard.press('Enter')
  await expect(block.locator('.dialogue-line')).toHaveCount(4)
  await expect(block.locator('.dialogue-line-kind')).toHaveCount(0)
  await page.keyboard.press(`${mod}+Enter`)
  expect(await lines(page)).toHaveLength(3)
  const selectionType = await page.locator('.ProseMirror').evaluate((element) => (element as EditorElement).editor.state.selection.$from.parent.type.name)
  expect(selectionType).toBe('paragraph')
})

test('Enter and Ctrl+Enter alternate; Shift+Enter keeps speaker and tighter spacing', async ({ page }) => {
  await selectLine(page, 0, true)
  await page.keyboard.press('Enter')
  await page.keyboard.type('Hi')
  await page.keyboard.press(`${mod}+Enter`)
  await page.keyboard.type('One')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('Two')
  const result = await lines(page)
  expect(result.map((line) => line.attrs?.characterId)).toEqual(['maya', 'alex', 'maya'])
  expect(result[2]?.content?.map((node) => node.type)).toEqual(['text', 'hardBreak', 'text'])
  const spacing = await page.locator('.dialogue-line').last().evaluate((element) => {
    const text = element.querySelector('.dialogue-text')!
    const breaks = text.querySelector('br')!
    const rect = (node: Node) => { const range = document.createRange(); range.selectNodeContents(node); return range.getBoundingClientRect() }
    const first = rect(breaks.previousSibling!)
    const second = rect(breaks.nextSibling!)
    return { within: second.top - first.top, between: element.getBoundingClientRect().top - element.previousElementSibling!.getBoundingClientRect().top }
  })
  expect(spacing.within).toBeGreaterThan(0)
  expect(spacing.between).toBeGreaterThan(spacing.within)
})

test('line menu offers switching and retained actions; duplicate/move/delete remain undoable', async ({ page }) => {
  await selectLine(page, 0)
  async function action(index: number, label: string) {
    await selectLine(page, index)
    await page.locator('.dialogue-line').nth(index).getByRole('button', { name: 'Line actions' }).click()
    await expect(page.getByRole('menuitem')).toHaveText(['Switch to narration', 'Duplicate line', 'Move up', 'Move down', 'Delete dialogue'])
    await page.getByRole('menuitem', { name: label, exact: true }).click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(page.locator('.ProseMirror')).toBeFocused()
  }
  await action(0, 'Duplicate line')
  expect(await lines(page)).toHaveLength(2)
  await page.keyboard.type(' copy')
  await action(1, 'Move up')
  expect((await lines(page))[0]?.content?.[0]?.text).toBe(' copyHello')
  await action(0, 'Move down')
  expect((await lines(page))[1]?.content?.[0]?.text).toBe(' copyHello')
  await action(1, 'Delete dialogue')
  expect(await lines(page)).toHaveLength(1)
  await page.keyboard.press(`${mod}+z`)
  expect(await lines(page)).toHaveLength(2)
})

test('line menu switches dialogue/narration without losing formatting and supports undo', async ({ page }) => {
  await selectLine(page, 0, true)
  await page.locator('.ProseMirror').evaluate((element) => (element as EditorElement).editor.chain().setTextSelection({ from: 2, to: 7 }).toggleBold().setTextSelection(7).setHardBreak().insertContent('Second line').run())
  const original = (await lines(page))[0]!
  expect(original.content?.some((node) => node.marks?.some((mark) => mark.type === 'bold'))).toBe(true)
  expect(original.content?.some((node) => node.type === 'hardBreak')).toBe(true)
  async function switchLine(label: string) {
    await page.locator('.dialogue-line').first().getByRole('button', { name: 'Line actions' }).click()
    await page.getByRole('menuitem', { name: label, exact: true }).click()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(page.locator('.ProseMirror')).toBeFocused()
  }
  await switchLine('Switch to narration')
  await expect(page.locator('.dialogue-line').first()).toHaveAttribute('data-kind', 'narration')
  expect((await lines(page))[0]?.attrs).toMatchObject({ kind: 'narration', characterId: null })
  expect((await lines(page))[0]?.content).toEqual(original.content)
  await switchLine('Switch to dialogue')
  await expect(page.locator('.dialogue-line').first()).toHaveAttribute('data-kind', 'speech')
  expect(await lines(page)).toHaveLength(1)
  expect((await lines(page))[0]?.content).toEqual(original.content)
  await expect(page.locator('.dialogue-speaker-name').first()).toHaveText(dialogueCharacters[0]!.name)
  await page.keyboard.press(`${mod}+z`)
  await expect(page.locator('.dialogue-line').first()).toHaveAttribute('data-kind', 'narration')
  expect((await lines(page))[0]?.content).toEqual(original.content)
  await page.keyboard.press(`${mod}+z`)
  await expect(page.locator('.dialogue-line').first()).toHaveAttribute('data-kind', 'speech')
  expect((await lines(page))[0]?.content).toEqual(original.content)
})

test('switch to dialogue is disabled until a scene has a character', async ({ page }) => {
  await selectLine(page, 0, true)
  await page.locator('.ProseMirror').evaluate((element) => (element as EditorElement).editor.chain().removeDialogueCharacter('maya').removeDialogueCharacter('alex').run())
  await expect(page.locator('.dialogue-line').first()).toHaveAttribute('data-kind', 'narration')
  await page.locator('.dialogue-line').first().getByRole('button', { name: 'Line actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Switch to dialogue', exact: true })).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Escape')
  await page.getByTestId('dialogue-settings').getByRole('button', { name: 'Add character', exact: true }).click()
  await selectLine(page, 0)
  await page.locator('.dialogue-line').first().getByRole('button', { name: 'Line actions' }).click()
  await page.getByRole('menuitem', { name: 'Switch to dialogue', exact: true }).click()
  await expect(page.locator('.dialogue-line').first()).toHaveAttribute('data-kind', 'speech')
  await expect(page.locator('.dialogue-text').first()).toHaveText('Hello')
})

test('block settings add and rename characters, and new characters are available in the speaker picker', async ({ page }) => {
  await selectLine(page, 0, true)
  const settings = page.getByTestId('dialogue-settings')
  const rows = settings.getByTestId('dialogue-character-settings')
  await expect(rows).toHaveCount(2)
  await settings.getByRole('button', { name: 'Add character', exact: true }).click()
  await expect(rows).toHaveCount(3)
  const name = rows.last().getByRole('textbox', { name: 'Character name', exact: true })
  await expect(name).toHaveValue('Character 3')
  await expect(name).toBeFocused()
  await name.fill('Jules')
  await name.press('Tab')
  await expect(rows.last().getByRole('button', { name: 'Character colour and avatar' })).toHaveText('J')
  expect(await lines(page)).toHaveLength(1)
  await selectLine(page, 0)
  await page.locator('.dialogue-speaker').first().click()
  const picker = page.getByTestId('dialogue-character-picker')
  await picker.getByRole('combobox').fill('Jules')
  await picker.getByRole('option', { name: 'Jules', exact: true }).click()
  await expect(page.locator('.dialogue-speaker-name').first()).toHaveText('Jules')
  await settings.getByRole('button', { name: 'Add character', exact: true }).click()
  await expect(rows).toHaveCount(4)
  await expect(rows.last().getByRole('textbox', { name: 'Character name', exact: true })).toHaveValue('Character 4')
})

test('add character respects the existing 24-character limit', async ({ page }) => {
  await selectLine(page, 0, true)
  await page.locator('.ProseMirror').evaluate((element, max) => {
    const editor = (element as EditorElement).editor
    for (let number = 3; number <= max; number += 1) editor.chain().setNodeSelection(0).upsertDialogueCharacter({ name: `Character ${number}` }).run()
  }, DIALOGUE_MAX_CHARACTERS)
  const settings = page.getByTestId('dialogue-settings')
  await expect(settings.getByTestId('dialogue-character-settings')).toHaveCount(DIALOGUE_MAX_CHARACTERS)
  await expect(settings.getByRole('button', { name: 'Add character', exact: true })).toBeDisabled()
  expect(await lines(page)).toHaveLength(1)
})

test('initials open palette and library avatar options; selecting and clearing an avatar updates the character', async ({ page }) => {
  await selectLine(page, 0, true)
  const settings = page.getByTestId('dialogue-settings')
  await settings.getByRole('button', { name: 'Avatar', exact: true }).click()
  const character = settings.getByTestId('dialogue-character-settings').first()
  const preview = character.getByRole('button', { name: 'Character colour and avatar' })
  await expect(preview).toHaveText('MW')
  await expect(character.getByRole('button', { name: 'Custom avatar from media library' })).toHaveCount(0)
  await preview.click()
  const appearance = page.getByTestId('dialogue-character-appearance')
  await expect(appearance.getByRole('button', { name: /^#/ })).toHaveCount(DIALOGUE_PALETTE.length)
  await appearance.getByRole('button', { name: DIALOGUE_PALETTE[4], exact: true }).click()
  await expect(appearance.getByRole('button', { name: DIALOGUE_PALETTE[4], exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(preview).toHaveAttribute('style', new RegExp(DIALOGUE_PALETTE[4]))
  const search = page.waitForRequest((request) => new URL(request.url()).pathname === '/api/media/search')
  await appearance.getByRole('button', { name: 'Custom avatar from media library' }).click()
  expect(new URL((await search).url()).searchParams.get('type')).toBe('image')
  const library = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Media Library', exact: true }) })
  await expect(library).toBeVisible()
  await library.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(library).toHaveCount(0)
  await expect(preview).toHaveText('MW')
  await preview.click()
  await appearance.getByRole('button', { name: 'Custom avatar from media library' }).click()
  await expect(library).toBeVisible()
  await library.locator(`[data-media-hash="${avatarHash}"]`).click()
  await library.getByRole('button', { name: 'Select', exact: true }).click()
  await expect(preview.locator('img')).toBeVisible()
  const avatar = page.locator('.dialogue-line .dialogue-avatar img').first()
  await expect(avatar).toHaveAttribute('src', new RegExp(`/media/${avatarHash}$`))
  expect(await avatar.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const savedCharacter = await page.locator('.ProseMirror').evaluate((element) => (element as EditorElement).editor.getJSON().content?.[0]?.attrs?.characters[0])
  expect(savedCharacter).toMatchObject({ avatarMediaId: avatarFixture.id, avatarSrc: `/media/${avatarHash}`, color: DIALOGUE_PALETTE[4] })
  await preview.click()
  await appearance.getByRole('button', { name: 'Clear avatar', exact: true }).click()
  await expect(preview).toHaveText('MW')
  await expect(preview.locator('img')).toHaveCount(0)
  await expect(page.locator('.dialogue-line .dialogue-avatar').first()).toHaveText('MW')
})

for (const width of [360, 768, 1440]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } })
    test('speaker typography and first-line alignment are consistent in all styles', async ({ page }) => {
      const block = page.locator('.dialogue-block')
      // Include a hard break and wrapping so the speaker cannot be centered
      // against the height of the entire dialogue instead of its first line.
      await page.locator('.ProseMirror').evaluate((element) => {
        const editor = (element as EditorElement).editor
        editor.chain().setTextSelection({ from: 2, to: 7 }).insertContent([
          { type: 'text', text: 'Hello from the first line' }, { type: 'hardBreak' },
          { type: 'text', text: 'A much longer second line that wraps over several visual lines to check first-line alignment.' }
        ]).run()
      })
      for (const style of ['compact', 'accent', 'avatar', 'avatar-image']) {
        await selectLine(page, 0, true)
        const dialogueStyle = style === 'avatar-image' ? 'avatar' : style
        await page.locator('.ProseMirror').evaluate((element, { dialogueStyle, withImage, avatarHash }) => {
          const editor = (element as EditorElement).editor
          const characters = editor.state.doc.firstChild!.attrs.characters.map((character: Record<string, unknown>, index: number) => withImage && index === 0 ? { ...character, avatarSrc: `/media/${avatarHash}`, avatarMediaId: `files:${avatarHash}` } : character)
          editor.commands.updateAttributes('dialogueBlock', { dialogueStyle, characters })
        }, { dialogueStyle, withImage: style === 'avatar-image', avatarHash })
        await expect(block).toHaveAttribute('data-style', dialogueStyle)
        if (style === 'avatar-image') await expect(block.locator('.dialogue-avatar img')).toBeVisible()
        const metrics = await block.locator('.dialogue-line').first().evaluate((element) => {
          const name = element.querySelector('.dialogue-speaker-name')!
          const text = element.querySelector('.dialogue-text')!
          const firstGlyphRect = (node: Element) => {
            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
            const first = walker.nextNode()!
            const range = document.createRange()
            range.setStart(first, 0)
            range.setEnd(first, 1)
            return range.getBoundingClientRect()
          }
          const nameRect = firstGlyphRect(name)
          const textRect = firstGlyphRect(text)
          const nameStyle = getComputedStyle(name)
          const textStyle = getComputedStyle(text)
          return {
            nameSize: nameStyle.fontSize, textSize: textStyle.fontSize,
            nameLineHeight: nameStyle.lineHeight, textLineHeight: textStyle.lineHeight,
            nameTop: nameRect.top, textTop: textRect.top
          }
        })
        expect(metrics.nameSize, style).toBe(metrics.textSize)
        expect(metrics.nameLineHeight, style).toBe(metrics.textLineHeight)
        if (width > 640) expect(Math.abs(metrics.nameTop - metrics.textTop), style).toBeLessThan(1)
        else expect(metrics.textTop, style).toBeGreaterThan(metrics.nameTop)
      }
    })
    test('trailing plus aligns under the character name in all styles', async ({ page }) => {
      const block = page.locator('.dialogue-block')
      for (const style of ['compact', 'accent', 'avatar']) {
        await selectLine(page, 0, true)
        await page.locator('.ProseMirror').evaluate((element, dialogueStyle) => (element as EditorElement).editor.commands.updateAttributes('dialogueBlock', { dialogueStyle }), style)
        await expect(block).toHaveAttribute('data-style', style)
        const plus = block.getByRole('button', { name: 'Add dialogue or narration', exact: true })
        const plusBox = await plus.boundingBox()
        const nameBox = await block.locator('.dialogue-speaker-name').last().boundingBox()
        const lineBox = await block.locator('.dialogue-line').last().boundingBox()
        expect(plusBox!.x).toBeCloseTo(nameBox!.x, 0)
        expect(plusBox!.y).toBeGreaterThanOrEqual(lineBox!.y + lineBox!.height)
      }
      await page.keyboard.press('Enter')
      await expect(block.locator('.dialogue-line-kind')).toHaveCount(0)
      await block.getByRole('button', { name: 'Add dialogue or narration', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Narration', exact: true }).click()
      await expect(page.locator('.ProseMirror')).toBeFocused()
      await page.keyboard.type('Narration')
      await expect(block.locator('.dialogue-text').last()).toHaveText('Narration')
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    })
  })
}
