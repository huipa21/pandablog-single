import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { ModuleKind, transpileModule } from 'typescript'
import * as vue from 'vue'
import * as renderer from 'vue/server-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

function loadComponent(path: string) {
  const { descriptor } = parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: path, inlineTemplate: true, templateOptions: { ssr: true } })
  const code = transpileModule(compiled.content.replaceAll('import.meta.client', 'false'), {
    compilerOptions: { module: ModuleKind.CommonJS }
  }).outputText
  const exports: { default?: vue.Component } = {}
  new Function('require', 'exports', code)((id: string) => {
    if (id === 'vue') return vue
    if (id === 'vue/server-renderer') return renderer
    throw new Error(`Unexpected component import: ${id}`)
  }, exports)
  if (!exports.default) throw new Error(`Missing component: ${path}`)
  return exports.default
}

const Avatar = loadComponent('../../components/ProfileAvatar.vue')
const PublicLayout = loadComponent('../../layouts/default.vue')
const ownerAvatar = vue.ref('/shared-avatar.svg')
const ownerName = vue.ref('Public Owner')
const loggedIn = vue.ref(true)

beforeEach(() => {
  ownerAvatar.value = '/shared-avatar.svg'
  ownerName.value = 'Public Owner'
  loggedIn.value = true
  for (const key of ['computed', 'ref', 'watch', 'useSlots'] as const) vi.stubGlobal(key, vue[key])
  vi.stubGlobal('useSiteSettings', () => ({
    ownerAvatar, ownerName,
    ...Object.fromEntries(['siteName', 'siteSubtitle', 'siteLogo', 'siteBanner', 'siteFavicon', 'footerCopyright'].map(key => [key, vue.ref('')])),
    ...Object.fromEntries(['siteBannerPositionX', 'siteBannerPositionY', 'siteBannerZoom', 'siteHeroHeightVh'].map(key => [key, vue.ref(50)])),
    footerLinks: vue.ref([]), footerSocial: vue.ref([]), footerFilings: vue.ref([]),
    footerShowPoweredBy: vue.ref(false), hasFilingInfo: vue.ref(false)
  }))
  vi.stubGlobal('useMediaUrl', () => ({ resolveMediaUrl: (value: string) => value ? `https://media.example.test${value}` : '' }))
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  vi.stubGlobal('useAdminToast', () => ({ error: vi.fn() }))
  vi.stubGlobal('usePublicBootstrap', async () => ({ data: vue.ref({ theme: null, themeMode: 'light' }), refresh: vi.fn() }))
  vi.stubGlobal('usePublicLocale', () => ({ locale: vue.ref('en') }))
  vi.stubGlobal('useThemeMode', () => ({ toggleIcon: vue.ref(''), toggleLabel: vue.ref(''), toggleThemeMode: vi.fn() }))
  vi.stubGlobal('usePostViewMode', () => ({ toggleIcon: vue.ref(''), toggleLabel: vue.ref(''), toggleViewMode: vi.fn() }))
  vi.stubGlobal('usePublicAuthSession', async () => ({
    data: vue.computed(() => ({ loggedIn: loggedIn.value, user: { avatar_url: '/old-account-avatar.svg' } }))
  }))
  vi.stubGlobal('useRoute', () => ({ path: '/', fullPath: '/', query: {} }))
  vi.stubGlobal('useHead', vi.fn())
})

afterEach(() => vi.unstubAllGlobals())

async function render(component: vue.Component) {
  const app = vue.createSSRApp(component)
  app.component('ProfileAvatar', Avatar)
  for (const name of ['BlogSearchBar', 'PublicLanguageSwitcher', 'UDropdownMenu', 'UButton', 'UIcon', 'PandaLogo']) {
    app.component(name, vue.defineComponent({
      setup(_, { slots }) { return () => vue.h('div', slots.default?.()) }
    }))
  }
  return renderer.renderToString(app)
}

describe('unified profile avatar', () => {
  it('renders the profile avatar in both authenticated public headers, not the old account avatar', async () => {
    const html = await render(PublicLayout)
    expect(html.match(/src="https:\/\/media.example.test\/shared-avatar.svg"/g)).toHaveLength(2)
    expect(html).not.toContain('old-account-avatar')
    expect(html).not.toContain('admin.layout.myProfile')
    expect(html).not.toContain('admin.layout.signOut')
  })

  it('keeps authenticated avatars hidden for anonymous visitors', async () => {
    loggedIn.value = false
    expect(await render(PublicLayout)).not.toContain('shared-avatar.svg')
  })

  it('uses the same initials when the profile avatar is cleared', async () => {
    ownerAvatar.value = ''
    const html = await render(Avatar)
    expect(html).toContain('PO')
    expect(html).not.toContain('<img')
    ownerName.value = ''
    expect(await render(Avatar)).toContain('>U</span>')
  })
})
