import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { ModuleKind, transpileModule } from 'typescript'
import * as vue from 'vue'
import * as pinia from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EditorOptions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { useEditorStore } from '../../stores/editor'
import type { JsonContent } from '../../types/content'
import { normalizeBlockPresentation } from '../../utils/blockPresentation'

// Execute the actual SFC setup with real Vue reactivity and Pinia. Tiptap/DOM
// adapters are replaced: these tests exercise inserter state, not rendering.
const source = readFileSync(new URL('../../components/admin/editor/blocks/BlockEditor.vue', import.meta.url), 'utf8')
const { descriptor } = parse(source)
const compiled = compileScript(descriptor, { id: 'editor-inserter-test' })
const pageSource = readFileSync(new URL('../../pages/admin/posts/[id].vue', import.meta.url), 'utf8')
const pageDescriptor = parse(pageSource).descriptor
const pageAst = compileScript(pageDescriptor, { id: 'editor-page-state-test' }).scriptSetupAst!
const postChangeWatcher = pageAst.find((node: any) => node.type === 'ExpressionStatement'
  && node.expression.type === 'CallExpression'
  && node.expression.callee.name === 'watch'
  && node.expression.arguments[0]?.name === 'id')
const code = transpileModule(compiled.content.replaceAll('import.meta', '({ client: false, dev: false, env: { DEV: false } })'), {
  compilerOptions: { module: ModuleKind.CommonJS }
}).outputText

const extension: any = new Proxy(() => extension, {
  get: (_target, key) => key === '__esModule' ? true : key === 'then' ? undefined : extension
})
let editor: any
let editorOptions: Partial<EditorOptions> | undefined
let modelValue: vue.Ref<JsonContent>
let state: any
let app: vue.App | undefined
let store: ReturnType<typeof useEditorStore>
let piniaInstance: pinia.Pinia
const host = vue.createRenderer<any, any>({
  insert: () => {}, remove: () => {}, createElement: () => ({}),
  createText: () => ({}), createComment: () => ({}), setText: () => {},
  setElementText: () => {}, parentNode: () => null, nextSibling: () => null,
  patchProp: () => {}
})

function loadComponent() {
  const exports: Record<string, any> = {}
  new Function('require', 'exports', code)((id: string) => {
    if (id === 'vue') return vue
    if (id === 'pinia') return pinia
    if (id === '@tiptap/vue-3') return { useEditor: (options: Partial<EditorOptions>) => {
      editorOptions = options
      return vue.shallowRef(editor)
    }, VueNodeViewRenderer: vi.fn() }
    if (id === '@tiptap/starter-kit') return { __esModule: true, default: StarterKit }
    if (id.endsWith('blockPresentation')) return { normalizeBlockPresentation }
    if (id === 'lowlight') return { common: {}, createLowlight: () => ({ register: vi.fn() }) }
    if (id.endsWith('useAutoScroll')) return { useAutoScroll: () => ({}) }
    if (id.endsWith('useMediaUrl')) return { useMediaUrl: () => ({ resolveMediaUrl: (url: string) => url, toPublicMediaUrl: (url: string) => url }) }
    return extension
  }, exports)
  const component = exports.default
  const setup = component.setup
  return { ...component, render: () => null, async setup(props: unknown, context: unknown) {
    state = await setup(props, context)
    return state
  } }
}

async function mount(initiallyOpen = false) {
  if (initiallyOpen) store.openInserter()
  const Component = loadComponent()
  app = host.createApp({ render: () => vue.h(vue.Suspense, null, {
    default: () => vue.h(Component, { modelValue: modelValue.value })
  }) })
  app.use(piniaInstance)
  app.mount({})
  await vi.waitFor(() => expect(state).toBeDefined())
  await vue.nextTick()
}

beforeEach(() => {
  state = undefined
  editorOptions = undefined
  modelValue = vue.ref<JsonContent>({ type: 'doc', content: [] })
  piniaInstance = pinia.createPinia()
  pinia.setActivePinia(piniaInstance)
  for (const key of ['ref', 'computed', 'watch', 'nextTick', 'onMounted', 'onBeforeUnmount'] as const) vi.stubGlobal(key, vue[key])
  vi.stubGlobal('useEditorStore', () => useEditorStore(piniaInstance))
  vi.stubGlobal('useBlockRegistry', () => ({ searchBlocks: () => [] }))
  vi.stubGlobal('useI18n', () => ({ t: (key: string) => key }))
  vi.stubGlobal('useMedia', () => ({ uploadFiles: vi.fn() }))
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), cancelAnimationFrame: vi.fn() })
  store = useEditorStore()
  const chain: any = { focus: () => chain, deleteRange: vi.fn(() => chain), run: vi.fn() }
  editor = { chain: () => chain, commands: { setContent: vi.fn() }, destroy: vi.fn(), isDestroyed: false, state: { doc: { content: { size: 20 }, forEach: vi.fn() } } }
})
afterEach(() => {
  app?.unmount()
  app = undefined
  vi.unstubAllGlobals()
  pinia.setActivePinia(undefined)
})

describe('BlockEditor inserter with real Pinia state', () => {
  it('disables v3 StarterKit additions handled by the existing editor', async () => {
    await mount()
    const starterKit = editorOptions?.extensions?.find((extension) => extension.name === 'starterKit')
    expect(starterKit?.options).toMatchObject({
      link: false,
      underline: false,
      trailingNode: false
    })
  })

  it('applies external content without emitting an update using the v3 options object', async () => {
    await mount()
    modelValue.value = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'External content' }] }] }
    await vue.nextTick()
    expect(editor.commands.setContent).toHaveBeenCalledExactlyOnceWith(
      normalizeBlockPresentation(modelValue.value),
      { emitUpdate: false }
    )
  })

  it('clears pending insertion and selection when the reused page changes posts', async () => {
    await mount()
    expect(postChangeWatcher).toBeDefined()
    const id = vue.ref('first')
    const scope = vue.effectScope()
    const watcherCode = transpileModule(pageDescriptor.scriptSetup!.content.slice(postChangeWatcher!.start!, postChangeWatcher!.end!), {
      compilerOptions: { module: ModuleKind.CommonJS }
    }).outputText
    try {
      scope.run(() => new Function('id', 'editorStore', 'watch', watcherCode)(id, store, vue.watch))
      state.openInserterWithoutTarget()
      state.insertAfterPos.value = 7
      store.selectBlock({ id: 'heading:7', type: 'heading', attrs: {}, pos: 7 })
      id.value = 'second'
      expect(store.inserterOpen).toBe(false)
      expect(state.insertAfterPos.value).toBeNull()
      expect(store.selectedBlockId).toBeNull()
    } finally {
      scope.stop()
    }
  })

  it('reflects an already-open store on first setup', async () => {
    await mount(true)
    expect(state.inserterOpen.value).toBe(true)
  })

  it('opens and closes the parent store synchronously through exposed editor actions', async () => {
    await mount()
    state.openInserterWithoutTarget()
    expect(store.inserterOpen).toBe(true)
    state.closeInserter()
    expect(store.inserterOpen).toBe(false)
  })

  it('reflects parent/mobile store actions immediately and clears targets on cancel', async () => {
    await mount()
    store.openInserter()
    expect(state.inserterOpen.value).toBe(true)
    state.insertAfterPos.value = 7
    store.closeInserter()
    expect(state.inserterOpen.value).toBe(false)
    expect(state.insertAfterPos.value).toBeNull()
  })

  it('captures a targeted insertion before close clears its position', async () => {
    await mount()
    state.activeBlockRange.value = { from: 3, to: 8, node: { type: { name: 'heading' }, content: { size: 2 } } }
    state.addBlockAfterCurrent()
    state.handleInserterPick('image')
    expect(store.inserterOpen).toBe(false)
    expect(state.pendingImageInsertPos.value).toBe(8)
    expect(state.insertAfterPos.value).toBeNull()
  })

  it('clears old targets on external close and same-tick reopen', async () => {
    await mount()
    state.openInserterWithoutTarget()
    state.insertAfterPos.value = 7
    state.insertReplaceRange.value = { from: 2, to: 4 }
    store.closeInserter()
    store.openInserter()
    expect(state.insertAfterPos.value).toBeNull()
    expect(state.insertReplaceRange.value).toBeNull()
    expect(state.inserterOpen.value).toBe(true)
  })

  it('opens a targeted + insertion immediately and untargeted opening resets it', async () => {
    await mount()
    state.activeBlockRange.value = { from: 3, to: 8, node: { type: { name: 'heading' }, content: { size: 2 } } }
    state.addBlockAfterCurrent()
    expect(store.inserterOpen).toBe(true)
    expect(state.insertAfterPos.value).toBe(8)
    state.openInserterWithoutTarget()
    expect(state.insertAfterPos.value).toBeNull()
    expect(state.insertReplaceRange.value).toBeNull()
  })

  it('captures an empty-paragraph replacement before closing on image pick', async () => {
    await mount()
    state.activeBlockRange.value = { from: 3, to: 5, node: { type: { name: 'paragraph' }, content: { size: 0 } } }
    state.addBlockAfterCurrent()
    expect(state.insertReplaceRange.value).toEqual({ from: 3, to: 5 })
    state.handleInserterPick('image')
    expect(store.inserterOpen).toBe(false)
    expect(state.pendingImageInsertPos.value).toBe(3)
    expect(state.mediaPickerOpen.value).toBe(true)
    expect(state.insertReplaceRange.value).toBeNull()
  })

  it('closes/reset editor-owned state when unmounted', async () => {
    await mount()
    state.openInserterWithoutTarget()
    state.insertAfterPos.value = 7
    await vue.nextTick()
    app!.unmount()
    app = undefined
    expect(store.inserterOpen).toBe(false)
    expect(state.insertAfterPos.value).toBeNull()
    expect(editor.destroy).toHaveBeenCalledOnce()
  })
})
