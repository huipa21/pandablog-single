import type { H3Event } from 'h3'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getActiveThemeId, invalidateThemeCache, loadTheme } from '../../server/utils/theme-loader'
import { ThemeManifestSchema, ThemeTokensSchema } from '../../server/utils/theme-validator'

const mocks = vi.hoisted(() => ({
  queryDb: vi.fn(), useDb: vi.fn(), requireOwner: vi.fn(), readBody: vi.fn(),
  getQuery: vi.fn(), getRouterParam: vi.fn(), setResponseHeader: vi.fn(), setResponseStatus: vi.fn(),
  invalidatePublicBootstrapCache: vi.fn(), writeAppSettings: vi.fn(),
  root: '',
  themePath(path: unknown) {
    return typeof path === 'string' && /^themes(?:[\\/]|$)/.test(path)
      ? `${this.root}/${path.replace(/^themes[\\/]?/, '')}`
      : path
  }
}))
vi.mock('../../server/utils/db', () => mocks)
vi.mock('../../server/utils/auth', () => ({ requireOwner: mocks.requireOwner }))
vi.mock('../../server/utils/publicBootstrap', () => ({ invalidatePublicBootstrapCache: mocks.invalidatePublicBootstrapCache }))
vi.mock('../../server/utils/settings', () => ({ writeAppSettings: mocks.writeAppSettings }))
// Redirect only relative theme reads to an owned temporary fixture. No checkout
// theme files, live database, environment or current working directory is changed.
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>()
  return { ...fs, existsSync: (path: Parameters<typeof fs.existsSync>[0]) => fs.existsSync(mocks.themePath(path) as typeof path) }
})
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...fs,
    readFile: (...args: Parameters<typeof fs.readFile>) => { args[0] = mocks.themePath(args[0]) as typeof args[0]; return fs.readFile(...args) },
    stat: (...args: Parameters<typeof fs.stat>) => { args[0] = mocks.themePath(args[0]) as typeof args[0]; return fs.stat(...args) },
    readdir: (...args: Parameters<typeof fs.readdir>) => { args[0] = mocks.themePath(args[0]) as typeof args[0]; return fs.readdir(...args) }
  }
})

const manifest = {
  id: 'default', name: 'Fixture theme', version: '1.0.0', author: 'Tests', description: '',
  supports: ['light', 'dark'], preview: 'preview.svg', tokens: 'tokens.json', css: 'theme.css',
  layout: { type: 'single-column', leftSidebar: null, rightSidebar: null, maxContentWidth: '72rem', showCoverImage: true, stickyHeader: true }
}
const tokens = { light: { color: { bg: 'white' } }, dark: { color: { bg: 'black' } } }

async function fixtureTheme(id: string) {
  const dir = join(mocks.root, id)
  await mkdir(dir)
  await writeFile(join(dir, 'theme.json'), JSON.stringify({ ...manifest, id, name: `${id} fixture` }))
  await writeFile(join(dir, 'tokens.json'), JSON.stringify(tokens))
  await writeFile(join(dir, 'theme.css'), '.fixture { color: var(--color-bg); }')
  await writeFile(join(dir, 'preview.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
}

beforeEach(async () => {
  vi.resetAllMocks()
  invalidateThemeCache()
  mocks.root = await mkdtemp(join(tmpdir(), 'pandablog-theme-management-'))
  await fixtureTheme('default')
  await fixtureTheme('existing-custom')
  mocks.useDb.mockResolvedValue({})
  mocks.queryDb.mockResolvedValue([[{ value: 'existing-custom' }]])
  mocks.getQuery.mockReturnValue({})
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('readBody', mocks.readBody)
  vi.stubGlobal('getQuery', mocks.getQuery)
  vi.stubGlobal('getRouterParam', mocks.getRouterParam)
  vi.stubGlobal('setResponseHeader', mocks.setResponseHeader)
  vi.stubGlobal('setResponseStatus', mocks.setResponseStatus)
  vi.stubGlobal('createError', (error: { message: string, statusCode: number }) => Object.assign(new Error(error.message), error))
})
afterEach(async () => {
  invalidateThemeCache()
  vi.unstubAllGlobals()
  await rm(mocks.root, { recursive: true, force: true })
})

const event = {} as H3Event

describe('deployment-managed themes', () => {
  it('removes runtime installation/deletion code and ZIP dependencies', async () => {
    for (const path of ['server/api/admin/themes/upload.post.ts', 'server/api/admin/themes/[id].delete.ts', 'server/utils/theme-installer.ts']) {
      expect(existsSync(path), path).toBe(false)
    }
    for (const path of ['package.json', 'package-lock.json']) {
      expect(await readFile(path, 'utf8')).not.toMatch(/"(?:@types\/)?adm-zip"/)
    }
    expect(await readFile('server/utils/theme-validator.ts', 'utf8')).not.toContain('validateCss')
  })

  it('keeps selection and preview UI without upload/delete controls in either locale', async () => {
    const source = await readFile('pages/admin/settings/themes.vue', 'utf8')
    expect(source).not.toMatch(/onUpload|requestRemove|confirmRemove|type="file"|FormData|AdminConfirmActionDialog/)
    expect(source).toContain('/api/admin/themes/activate')
    expect(source).toContain('openPreview(theme.id)')
    for (const locale of ['en', 'zh-CN']) {
      const text = JSON.parse(await readFile(`i18n/locales/${locale}.json`, 'utf8')).admin.settings.themes
      expect(text).toHaveProperty('deploymentHelp')
      for (const key of ['uploadTitle', 'uploading', 'uploadZip', 'delete', 'deleteTitle', 'deleteDescription', 'deleteFallback', 'pickZip', 'installedToast', 'uploadFailed', 'deleted', 'deleteFailed']) {
        expect(text).not.toHaveProperty(key)
      }
    }
  })

  it.each(['default', 'tesla', 'notion', 'clay'])('keeps the bundled %s manifest and token schemas compatible', async id => {
    const dir = join(process.cwd(), 'themes', id)
    const deployed = ThemeManifestSchema.parse(JSON.parse(await readFile(join(dir, 'theme.json'), 'utf8')))
    expect(deployed.id).toBe(id)
    expect(ThemeTokensSchema.parse(JSON.parse(await readFile(join(dir, deployed.tokens), 'utf8')))).toHaveProperty('dark.color')
  })

  it('lists existing custom themes and preserves the saved active ID without writing settings', async () => {
    const { default: handler } = await import('../../server/api/admin/themes/index.get')
    const result = await handler(event)
    expect(result.activeId).toBe('existing-custom')
    expect(result.themes.map(theme => theme.id).sort()).toEqual(['default', 'existing-custom'])
    expect(mocks.requireOwner).toHaveBeenCalledWith(event)
    expect(mocks.queryDb).toHaveBeenCalledTimes(1)
    expect(mocks.queryDb.mock.calls[0]![1]).toMatch(/^SELECT /)
    expect(await readFile(join(mocks.root, 'existing-custom', 'theme.json'), 'utf8')).toContain('existing-custom')
  })

  it('continues to compile and cache light/dark tokens and theme overrides', async () => {
    const theme = await loadTheme('existing-custom')
    expect(theme?.compiledCss).toContain(`:root {\n  --color-bg: ${tokens.light.color.bg};`)
    expect(theme?.compiledCss).toContain(`[data-theme="dark"] {\n  --color-bg: ${tokens.dark.color.bg};`)
    expect(theme?.compiledCss).toContain('@media (prefers-color-scheme: dark)')
    expect(theme?.compiledCss).toContain('--layout-max-content: 72rem;')
    expect(theme?.compiledCss).toContain('.fixture { color: var(--color-bg); }')
    expect(await loadTheme('existing-custom')).toBe(theme)
    expect(mocks.queryDb).not.toHaveBeenCalled()
  })

  it('serves the saved active theme and supports preview without changing its selection', async () => {
    const { default: handler } = await import('../../server/api/theme/css.get')
    expect(await handler(event)).toContain('Theme: existing-custom fixture')
    expect(mocks.setResponseHeader).toHaveBeenCalledWith(event, 'Cache-Control', 'no-cache, must-revalidate')
    mocks.getQuery.mockReturnValue({ theme: 'default' })
    expect(await handler(event)).toContain('Theme: default fixture')
    expect(mocks.setResponseHeader).toHaveBeenCalledWith(event, 'Cache-Control', 'no-store')
    expect(await getActiveThemeId()).toBe('existing-custom')
    expect(mocks.queryDb).toHaveBeenCalledTimes(1)
  })

  it('falls back to default CSS for an absent theme without rewriting the saved setting', async () => {
    mocks.queryDb.mockResolvedValue([[{ value: 'missing-custom' }]])
    const { default: handler } = await import('../../server/api/theme/css.get')
    expect(await handler(event)).toContain('Theme: default fixture')
    expect(await getActiveThemeId()).toBe('missing-custom')
    expect(mocks.queryDb).toHaveBeenCalledTimes(1)
    expect(mocks.setResponseHeader).toHaveBeenCalledWith(event, 'Cache-Control', 'no-store')
  })

  it('continues to serve deployed custom preview images', async () => {
    mocks.getRouterParam.mockImplementation((_event, key) => key === 'id' ? 'existing-custom' : 'preview.svg')
    const { default: handler } = await import('../../server/routes/themes/[id]/[...path].get')
    expect((await handler(event)).toString()).toContain('<svg ')
    expect(mocks.setResponseHeader).toHaveBeenCalledWith(event, 'Content-Type', 'image/svg+xml')
    expect(mocks.queryDb).not.toHaveBeenCalled()
  })

  it.each([['theme.css', 403], ['../tokens.json', 400]])('refuses non-image or unsafe asset paths: %s', async (path, statusCode) => {
    mocks.getRouterParam.mockImplementation((_event, key) => key === 'id' ? 'existing-custom' : path)
    const { default: handler } = await import('../../server/routes/themes/[id]/[...path].get')
    await expect(handler(event)).rejects.toMatchObject({ statusCode })
  })

  it('activates a deployed custom theme with the existing settings format', async () => {
    mocks.readBody.mockResolvedValue({ themeId: 'existing-custom' })
    const { default: handler } = await import('../../server/api/admin/themes/activate.post')
    expect(await handler(event)).toEqual({ ok: true, activeId: 'existing-custom' })
    expect(mocks.queryDb).toHaveBeenCalledExactlyOnceWith(expect.anything(),
      "UPSERT app_settings:active_theme CONTENT { key: 'active_theme', value: $id }", { id: 'existing-custom' })
    expect(mocks.invalidatePublicBootstrapCache).toHaveBeenCalledTimes(1)
  })

  it('rejects unavailable themes before writing settings', async () => {
    mocks.readBody.mockResolvedValue({ themeId: 'missing-custom' })
    const { default: handler } = await import('../../server/api/admin/themes/activate.post')
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 404 })
    expect(mocks.queryDb).not.toHaveBeenCalled()
    expect(mocks.invalidatePublicBootstrapCache).not.toHaveBeenCalled()
  })

  it.each(['light', 'dark'])('preserves the public %s-mode setting contract', async mode => {
    mocks.readBody.mockResolvedValue({ mode })
    const { default: handler } = await import('../../server/api/theme/mode.post')
    expect(await handler(event)).toEqual({ ok: true, mode })
    expect(mocks.writeAppSettings).toHaveBeenCalledExactlyOnceWith({ public_theme_mode: mode }, ['public_theme_mode'])
  })

  it.each(['index.get', 'activate.post'])('denies unauthorized %s requests before reading theme data or settings', async route => {
    mocks.requireOwner.mockRejectedValue(Object.assign(new Error('Forbidden'), { statusCode: 403 }))
    const { default: handler } = route === 'index.get'
      ? await import('../../server/api/admin/themes/index.get')
      : await import('../../server/api/admin/themes/activate.post')
    await expect(handler(event)).rejects.toMatchObject({ statusCode: 403 })
    expect(mocks.readBody).not.toHaveBeenCalled()
    expect(mocks.queryDb).not.toHaveBeenCalled()
  })
})
