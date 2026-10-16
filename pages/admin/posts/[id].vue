<template>
  <section class="flex flex-col overflow-hidden bg-[var(--pb-app-bg)]" :style="editorShellStyle">
    <div class="pb-editor-topbar z-20 border-b border-[var(--pb-divider)] bg-[var(--pb-card-bg)] px-3 py-2 md:px-4">
      <div class="pb-editor-primary-row">
        <UButton class="pb-editor-back" to="/admin/posts" type="button" variant="ghost" color="neutral" icon="i-lucide-arrow-left" size="sm">
          {{ t('admin.editor.backToPosts') }}
        </UButton>

        <div class="pb-editor-actions">
          <UButton
            type="button"
            icon="i-lucide-save"
            variant="soft"
            size="sm"
            :loading="savingAction === 'save-local'"
            :disabled="savingAction !== null"
            :aria-label="t('admin.editor.save')"
            @click="saveLocal()"
          >
            <span class="hidden sm:inline">{{ t('admin.editor.save') }}</span>
          </UButton>
          <UButton
            type="button"
            icon="i-lucide-send"
            color="primary"
            size="sm"
            :loading="savingAction === 'publish'"
            :disabled="savingAction !== null"
            :aria-label="currentStatus === 'published' ? t('admin.editor.update') : t('admin.editor.publish')"
            @click="publishOrUpdate()"
          >
            <span class="hidden sm:inline">{{ currentStatus === 'published' ? t('admin.editor.update') : t('admin.editor.publish') }}</span>
          </UButton>
          <UButton
            type="button"
            icon="i-lucide-history"
            variant="soft"
            color="neutral"
            size="sm"
            :aria-label="t('admin.editor.versions')"
            @click="openVersionHistory"
          >
            <span class="hidden sm:inline">{{ t('admin.editor.versions') }}</span>
          </UButton>
          <UButton
            type="button"
            icon="i-lucide-settings"
            variant="soft"
            color="neutral"
            size="sm"
            :aria-label="t('admin.editor.postSettings.open')"
            @click="postSettingsOpen = true"
          />
          <UButton
            type="button"
            icon="i-lucide-external-link"
            variant="soft"
            color="neutral"
            size="sm"
            :disabled="!canOpenPreview || savingAction !== null"
            :aria-label="t('admin.editor.view')"
            @click="openPostView"
          >
            <span class="hidden sm:inline">{{ t('admin.editor.view') }}</span>
          </UButton>
          <UButton type="button" icon="i-lucide-plus" color="neutral" variant="soft" size="sm" class="md:hidden" :aria-label="t('admin.editor.inserter.open')" data-testid="mobile-open-inserter" @click="editorStore.openInserter()" />
          <UButton type="button" icon="i-lucide-panel-right-open" color="neutral" variant="soft" size="sm" class="md:hidden" :aria-label="t('admin.editor.sidebar.post')" data-testid="mobile-open-editor-sidebar" @click="rightPaneCollapsed = false" />
          <UDropdownMenu :items="moreMenuItems">
            <UButton type="button" icon="i-lucide-ellipsis-vertical" color="neutral" variant="ghost" size="sm" />
          </UDropdownMenu>
        </div>
      </div>

      <div class="pb-editor-summary-row">
        <div class="truncate text-sm font-medium text-[var(--pb-text)]">{{ form.title || t('admin.editor.noTitle') }}</div>
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--pb-text-subtle)]">
          <span>{{ statusLabel(currentStatus) }}</span>
          <span v-if="saveStatus" :class="saveStatusClass">· {{ saveStatus }}</span>
          <span v-else-if="post?.updated_at">· {{ t('admin.editor.savedAt', { date: formatDate(post.updated_at) }) }}</span>
        </div>
      </div>
    </div>

    <div v-if="pending" class="mx-auto grid max-w-3xl gap-5 px-6 py-10">
      <USkeleton class="h-14" />
      <USkeleton class="h-96" />
    </div>

    <div
      v-else
      class="relative flex min-h-0 flex-1 overflow-hidden"
      @touchstart.passive="onEditorTouchStart"
      @touchend.passive="onEditorTouchEnd"
    >
      <BlockInserterPanel
        :open="editorStore.inserterOpen"
        inline
        @close="editorStore.closeInserter()"
        @insert="onInserterPick"
      />

      <main
        class="min-w-0 flex-1 overflow-y-auto px-3 py-4 pb-24 transition-[padding] duration-200 md:px-6 md:py-6 md:pb-6 lg:px-8"
        :class="editorStore.inserterOpen ? 'md:pl-[348px] lg:pl-[356px]' : ''"
      >
        <div class="pb-content-frame mx-auto">
          <div class="mb-4 space-y-3">
            <UAlert v-if="loadError" color="error" icon="i-lucide-circle-alert" :title="t('admin.editor.loadPostFailed')" />
          </div>

          <form class="pb-editor-grid-shell rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] px-4 py-5 shadow-[var(--pb-shadow-sm)] md:px-10 md:py-8" @submit.prevent="saveLocal()">
            <div class="pb-editor-row mb-8">
              <div class="pb-editor-gutter" aria-hidden="true" />
              <input
                v-model="form.title"
                type="text"
                :placeholder="t('admin.editor.addTitle')"
                class="w-full border-0 bg-transparent text-4xl font-semibold leading-tight tracking-normal text-[var(--pb-text)] outline-none placeholder:text-[var(--pb-text-placeholder)] md:text-5xl"
              >
              <div class="pb-editor-gutter" aria-hidden="true" />
            </div>

            <BlockEditor ref="blockEditorRef" v-model="form.content" :use-inline-inserter="true" />
          </form>
        </div>
      </main>

      <div data-editor-right-pane class="fixed inset-0 z-50 flex h-full shrink-0 flex-col border-l border-[var(--pb-divider)] bg-[var(--pb-card-bg)] transition-[width] md:relative md:z-auto" :class="rightPaneCollapsed ? 'hidden md:flex md:w-11' : 'w-full md:w-[340px]'">
        <div class="flex shrink-0 items-center p-1.5">
          <button
            type="button"
            class="inline-flex size-8 items-center justify-center rounded-[var(--pb-radius-sm)] border border-[var(--pb-divider)] bg-[var(--pb-card-bg)] text-[var(--pb-icon-muted)] hover:border-[var(--pb-selected-border)] hover:text-[var(--pb-link-hover)] md:size-7"
            :title="rightPaneCollapsed ? t('admin.editor.expandRightPane') : t('admin.editor.collapseRightPane')"
            @click="rightPaneCollapsed = !rightPaneCollapsed"
          >
            <UIcon :name="rightPaneCollapsed ? 'i-lucide-chevrons-left' : 'i-lucide-chevrons-right'" class="size-4" />
          </button>
        </div>

        <EditorSidebar
          v-if="!rightPaneCollapsed"
          class="min-h-0 flex-1 w-full md:w-[340px]"
          :editor="activeEditor"
          :mode="rightPaneMode"
          :versions="versions"
          @close-versions="rightPaneMode = 'settings'"
          @diff-version="showVersionDiff"
          @restore-version="restoreSelectedVersion"
          @delete-version="deleteSelectedVersion"
        />
      </div>
    </div>

    <PostSettingsModal
      v-model:open="postSettingsOpen"
      :form="form"
      :categories="categories"
      :tags="tags"
      :current-status="currentStatus"
      :current-post-id="post?.id ?? `post:${id}`"
      :saving-action="savingAction"
      @confirm="confirmPublishOrUpdate"
    />

    <UModal v-model:open="leaveDialogOpen">
      <template #content>
        <UCard>
          <template #header>
            <div>
              <h3 class="text-base font-semibold text-[var(--pb-text)]">{{ t('admin.editor.unsavedChanges') }}</h3>
              <p class="text-xs text-[var(--pb-text-subtle)]">{{ t('admin.editor.leaveDescription') }}</p>
            </div>
          </template>

          <div class="text-sm text-[var(--pb-text-muted)]">
            {{ t('admin.editor.unsavedBody') }}
          </div>

          <template #footer>
            <div class="flex flex-wrap justify-end gap-2">
              <UButton type="button" color="neutral" variant="ghost" :disabled="savingAction === 'save-db'" @click="cancelLeave">{{ t('admin.common.cancel') }}</UButton>
              <UButton type="button" color="warning" variant="soft" :disabled="savingAction === 'save-db'" @click="discardAndLeave">{{ t('admin.editor.discard') }}</UButton>
              <UButton type="button" color="primary" icon="i-lucide-save" :loading="savingAction === 'save-db'" @click="saveAndLeave">{{ t('admin.editor.saveToDb') }}</UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <UModal
      v-model:open="localConflictOpen"
      :dismissible="false"
      :close="false"
      :ui="{ content: 'w-[calc(100vw-1rem)] max-w-6xl sm:w-[calc(100vw-2rem)]' }"
    >
      <template #content>
        <UCard>
          <template #header>
            <div>
              <h3 class="text-base font-semibold text-[var(--pb-text)]">{{ t('admin.editor.localConflict.title') }}</h3>
              <p class="text-xs text-[var(--pb-text-subtle)]">{{ t('admin.editor.localConflict.description') }}</p>
            </div>
          </template>

          <div class="space-y-4">
            <div class="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--pb-text-subtle)]">
              <span v-if="localConflictServerSavedAtLabel">{{ t('admin.editor.localConflict.serverSavedAt', { date: localConflictServerSavedAtLabel }) }}</span>
              <span v-if="localConflictSavedAtLabel">{{ t('admin.editor.localConflict.localSavedAt', { date: localConflictSavedAtLabel }) }}</span>
            </div>

            <div v-if="localConflictChangedFields.length" class="text-sm text-[var(--pb-text-muted)]">
              <span class="font-medium text-[var(--pb-text)]">{{ t('admin.editor.localConflict.changedFields') }}</span>
              <ul class="mt-1 flex flex-wrap gap-1.5">
                <li
                  v-for="field in localConflictChangedFields"
                  :key="field"
                  class="rounded-[var(--pb-radius-sm)] border border-[var(--pb-divider)] bg-[var(--pb-app-bg)] px-2 py-0.5 text-xs text-[var(--pb-text-muted)]"
                >
                  {{ t(`admin.editor.localConflict.fields.${field}`) }}
                </li>
              </ul>
            </div>

            <div>
              <span class="text-sm font-medium text-[var(--pb-text)]">{{ t('admin.editor.localConflict.contentLabel') }}</span>
              <div class="mt-2 max-h-[52vh] overflow-auto rounded-[var(--pb-radius-card-inner)] border border-[var(--pb-divider)]">
                <RenderedBlockDiffSurface
                  :old-doc="post?.content_json ?? null"
                  :new-doc="pendingLocalDraft?.content_json ?? null"
                  :old-text="localConflictServerText"
                  :new-text="localConflictLocalText"
                  :old-label="t('admin.editor.localConflict.diffBefore')"
                  :new-label="t('admin.editor.localConflict.diffAfter')"
                />
              </div>
            </div>
          </div>

          <template #footer>
            <div class="flex flex-wrap justify-end gap-2">
              <UButton type="button" color="neutral" variant="ghost" @click="discardLocalDraft">{{ t('admin.editor.localConflict.useServer') }}</UButton>
              <UButton type="button" color="primary" icon="i-lucide-history" @click="applyLocalDraft">{{ t('admin.editor.localConflict.keepLocal') }}</UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>

    <UModal v-model:open="versionHistoryOpen" :ui="{ content: 'w-[calc(100vw-1rem)] max-w-6xl sm:w-[calc(100vw-2rem)]' }">
      <template #content>
        <UCard>
          <template #header>
            <div>
              <h3 class="text-base font-semibold text-[var(--pb-text)]">{{ t('admin.editor.versions') }}</h3>
              <p class="text-xs text-[var(--pb-text-subtle)]">{{ selectedVersion ? formatVersionDate(selectedVersion) : '' }}</p>
            </div>
          </template>

          <div class="min-h-[280px] max-h-[60vh] overflow-auto rounded-[var(--pb-radius-card-inner)] border border-[var(--pb-divider)]">
            <div v-if="versionDetailPending" class="grid gap-3 p-4">
              <USkeleton class="h-10" />
              <USkeleton class="h-32" />
            </div>
            <RenderedBlockDiffSurface
              v-else-if="selectedVersionDoc"
              :old-doc="selectedVersionDoc"
              :new-doc="post?.content_json ?? null"
              :old-text="docToDiffText(selectedVersionDoc)"
              :new-text="docToDiffText(post?.content_json ?? null)"
              :old-label="selectedVersion ? formatVersionDate(selectedVersion) : 'Snapshot'"
              new-label="Current"
            />
            <div v-else class="p-4 text-sm text-[var(--pb-text-muted)]">Select a snapshot to preview its diff.</div>
          </div>

          <template #footer>
            <div class="flex flex-wrap justify-end gap-2">
              <UButton type="button" color="neutral" variant="ghost" @click="versionHistoryOpen = false">Close</UButton>
              <UButton type="button" color="primary" icon="i-lucide-rotate-ccw" :disabled="!selectedVersion" @click="restoreFromDiff">{{ t('admin.editor.versionsPanel.restore') }}</UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </section>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import BlockEditor from '~/components/admin/editor/blocks/BlockEditor.vue'
import BlockInserterPanel from '~/components/admin/editor/blocks/BlockInserterPanel.vue'
import EditorSidebar from '~/components/admin/editor/EditorSidebar.vue'
import PostSettingsModal from '~/components/admin/editor/PostSettingsModal.vue'
import RenderedBlockDiffSurface from '~/components/content/RenderedBlockDiffSurface.vue'
import type { CategoryRecord, JsonContent, PostRecord, PostStatus, TagRecord } from '~/types/content'
import type { AdminPostEditorForm } from '~/types/editor'
import { docToDiffText } from '~/utils/contentDiffText'
import { normalizeDocForComparison, normalizeDocForSave } from '~/utils/emptyBlocks'
import { hasRenderedBlockChanges } from '~/utils/renderedBlockDiff'

definePageMeta({ layout: 'admin', adminWide: true, adminHideSidebar: true })

type BlockEditorInstance = InstanceType<typeof BlockEditor> & { editor?: Editor, pickBlock?: (name: string) => void }
const readFetchTimeoutMs = 10_000
const writeFetchTimeoutMs = 30_000

const route = useRoute()
const { t } = useI18n()
const { formatAdminDateTime, formatAdminTime } = useAdminRegionalSettings()
const id = computed(() => String(route.params.id))
const apiPath = computed(() => `/api/admin/posts/${encodeURIComponent(id.value)}`)
const sessionFetch = useSessionFetch()
const savingAction = ref<'save-local' | 'save-db' | 'publish' | 'unpublish' | null>(null)
const saveStatus = ref('')
const saveStatusType = ref<'success' | 'error'>('success')
const adminToast = useAdminToast()
const currentStatus = ref<PostStatus>('draft')
const blockEditorRef = ref<BlockEditorInstance | null>(null)
const editorStore = useEditorStore()
// Nuxt can reuse this page/editor when only the post parameter changes.
watch(id, () => {
  editorStore.closeInserter()
  editorStore.selectBlock(null)
}, { flush: 'sync' })
const rightPaneCollapsed = ref(true)
const leaveDialogOpen = ref(false)
const postSettingsOpen = ref(false)
const localConflictOpen = ref(false)
const pendingLocalDraft = ref<LocalDraftPayload | null>(null)
const versionHistoryOpen = ref(false)
const rightPaneMode = ref<'settings' | 'versions'>('settings')
const versions = ref<PostVersionRecord[]>([])
const selectedVersion = ref<PostVersionRecord | null>(null)
const selectedVersionDoc = ref<JsonContent | null>(null)
const versionDetailPending = ref(false)
const editorTouchStart = ref<{ x: number, y: number } | null>(null)
const pendingLeavePath = ref<string | null>(null)
const bypassLeaveGuard = ref(false)
const hasLoadedDbSnapshot = ref(false)
const savedDbSnapshot = ref('')
const keepNewDraftShell = ref(false)
const editorVisualViewportHeight = ref('100dvh')
const slugManuallyEdited = ref(false)
const adminPostBreadcrumb = useState<{ id: string, slug: string } | null>('admin-post-breadcrumb', () => null)

const saveStatusClass = computed(() =>
  saveStatusType.value === 'error' ? 'text-red-600' : 'text-[var(--pb-text-subtle)]'
)

const editorShellStyle = computed(() => ({
  height: `calc(${editorVisualViewportHeight.value} - 3.5rem)`
}))

onMounted(() => {
  if (window.innerWidth >= 768) {
    rightPaneCollapsed.value = false
  }

  syncEditorVisualViewportHeight()
  window.visualViewport?.addEventListener('resize', syncEditorVisualViewportHeight)
  window.visualViewport?.addEventListener('scroll', syncEditorVisualViewportHeight)
  window.addEventListener('resize', syncEditorVisualViewportHeight)
})

onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener('resize', syncEditorVisualViewportHeight)
  window.visualViewport?.removeEventListener('scroll', syncEditorVisualViewportHeight)
  window.removeEventListener('resize', syncEditorVisualViewportHeight)
  document.documentElement.style.removeProperty('--pb-editor-keyboard-inset')
})

function syncEditorVisualViewportHeight() {
  const viewport = window.visualViewport
  const height = viewport?.height ?? window.innerHeight
  const keyboardInset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0
  editorVisualViewportHeight.value = `${Math.round(height)}px`
  document.documentElement.style.setProperty('--pb-editor-keyboard-inset', `${Math.round(keyboardInset)}px`)
}

function onInserterPick(name: string) {
  blockEditorRef.value?.pickBlock?.(name)
}
const activeEditor = computed(() => blockEditorRef.value?.editor ?? null)

const form = reactive<AdminPostEditorForm>({
  title: '',
  slug: '',
  summary: '',
  cover_image: '',
  category_ids: [],
  tag_ids: [],
  category_names: [],
  tag_names: [],
  visibility: 'public',
  password: '',
  password_hint: '',
  related_post_ids: [],
  related_posts: [],
  content: emptyDoc()
})

const viewLink = computed(() => {
  const slug = form.slug?.trim() || post.value?.slug?.trim() || ''
  return slug ? `/blog/${encodeURIComponent(slug)}` : ''
})
const localPreviewLink = computed(() => `/admin/posts/preview/${encodeURIComponent(id.value)}`)
const canOpenPreview = computed(() => currentStatus.value === 'draft' || Boolean(viewLink.value))

const [
  { data: post, pending, error: loadError },
  { data: categoriesData, refresh: refreshCategories },
  { data: tagsData, refresh: refreshTags }
] = await Promise.all([
  useAsyncData(`admin-post-${id.value}`, () => fetchAdmin<PostRecord>(apiPath.value)),
  useAsyncData('admin-post-categories', () => fetchAdmin<{ categories: CategoryRecord[] }>('/api/admin/categories'), { default: () => ({ categories: [] }) }),
  useAsyncData('admin-post-tags', () => fetchAdmin<{ tags: TagRecord[] }>('/api/admin/tags'), { default: () => ({ tags: [] }) })
])
const categories = computed(() => categoriesData.value?.categories ?? [])
const tags = computed(() => tagsData.value?.tags ?? [])

const moreMenuItems = computed(() => {
  const items: any[][] = []
  if (currentStatus.value === 'published') {
    items.push([{
      label: t('admin.editor.actions.unpublish'),
      icon: 'i-lucide-rotate-ccw',
      onSelect: () => save('draft', 'unpublish')
    }])
  }
  items.push([{
    label: t('admin.editor.actions.archive'),
    icon: 'i-lucide-archive',
    color: 'error' as const,
    onSelect: archivePost
  }])
  return items
})

watch(post, (value) => {
  if (!value) {
    return
  }

  form.title = value.title
  form.slug = value.slug
  slugManuallyEdited.value = false
  form.summary = value.summary ?? ''
  form.cover_image = value.cover_image ?? ''
  form.category_ids = [...(value.category_ids ?? [])]
  form.tag_ids = [...(value.tag_ids ?? [])]
  form.category_names = []
  form.tag_names = []
  currentStatus.value = value.status === 'archived' ? 'draft' : value.status
  form.visibility = value.visibility ?? 'public'
  form.password_hint = value.password_hint ?? ''
  form.password = ''
  form.related_post_ids = [...(value.related_post_ids ?? [])]
  form.related_posts = [...(value.related_posts ?? [])]
  form.content = value.content_json
  savedDbSnapshot.value = serializeDbPayload()
  hasLoadedDbSnapshot.value = true
  adminPostBreadcrumb.value = { id: value.id, slug: value.slug }
}, { immediate: true })

watch(() => form.title, (title) => {
  if (!slugManuallyEdited.value) {
    form.slug = slugifyTitle(title)
  }
})

watch(() => form.slug, (slug, previousSlug) => {
  if (!hasLoadedDbSnapshot.value || slug === previousSlug) {
    return
  }

  if (slug !== slugifyTitle(form.title)) {
    slugManuallyEdited.value = true
  }
})

const hasUnsavedDbChanges = computed(() => {
  if (!hasLoadedDbSnapshot.value) {
    return false
  }

  return serializeDbPayload() !== savedDbSnapshot.value
})

const isNewDraftShell = computed(() => {
  if (route.query.new !== '1' || keepNewDraftShell.value || !hasLoadedDbSnapshot.value) {
    return false
  }

  const loadedPost = post.value
  return loadedPost?.status === 'draft'
    && !loadedPost.title.trim()
    && isEmptyDocContent(loadedPost.content_json)
})

const needsLeaveDecision = computed(() => hasUnsavedDbChanges.value || isNewDraftShell.value)

// ─── LOCAL SAVE (localStorage) ───────────────────────────────────────────────
const localStorageKey = computed(() => `pb-post-local-${id.value}`)

function saveLocal() {
  savingAction.value = 'save-local'
  try {
    const payload = {
      title: form.title,
      slug: form.slug,
      summary: form.summary,
      cover_image: form.cover_image,
      category_ids: form.category_ids,
      tag_ids: form.tag_ids,
      category_names: form.category_names,
      tag_names: form.tag_names,
      visibility: form.visibility,
      password: form.password,
      password_hint: form.password_hint,
      related_post_ids: form.related_post_ids,
      content_json: strippedContent(),
      savedAt: new Date().toISOString()
    }
    localStorage.setItem(localStorageKey.value, JSON.stringify(payload))
    const timeStr = formatTime(new Date())
    saveStatus.value = t('admin.editor.localSavedAt', { time: timeStr })
    saveStatusType.value = 'success'
    return true
  } catch (err: any) {
    adminToast.error(err, t('admin.editor.localSaveFailed'))
    saveStatus.value = t('admin.editor.saveFailed')
    saveStatusType.value = 'error'
    return false
  } finally {
    savingAction.value = null
  }
}

function openPostView() {
  if (currentStatus.value === 'draft') {
    if (saveLocal()) {
      window.open(localPreviewLink.value, '_blank', 'noopener')
    }
    return
  }

  if (viewLink.value) {
    window.open(viewLink.value, '_blank', 'noopener')
  }
}

function clearLocalSave() {
  localStorage.removeItem(localStorageKey.value)
}

function loadLocalSave(): LocalDraftPayload | null {
  try {
    const raw = localStorage.getItem(localStorageKey.value)
    if (!raw) return null
    return JSON.parse(raw) as LocalDraftPayload
  } catch { return null }
}

// ─── LOCAL DRAFT CONFLICT DETECTION ──────────────────────────────────────────
interface LocalDraftPayload {
  title?: string
  slug?: string
  summary?: string
  cover_image?: string
  category_ids?: string[]
  tag_ids?: string[]
  category_names?: string[]
  tag_names?: string[]
  visibility?: string
  password?: string
  password_hint?: string
  related_post_ids?: string[]
  content_json?: JsonContent
  savedAt?: string
}

interface PostVersionRecord {
  id: string
  version: string
  datetime: string
  diff: Array<Record<string, unknown>>
}

type LocalConflictFieldKey = 'title' | 'slug' | 'summary' | 'cover_image' | 'category_ids' | 'tag_ids' | 'visibility' | 'password_hint' | 'related_post_ids' | 'content_json'

const LOCAL_CONFLICT_FIELDS: Array<{ key: LocalConflictFieldKey, label: string }> = [
  { key: 'title', label: 'title' },
  { key: 'slug', label: 'slug' },
  { key: 'summary', label: 'summary' },
  { key: 'cover_image', label: 'cover' },
  { key: 'category_ids', label: 'categories' },
  { key: 'tag_ids', label: 'tags' },
  { key: 'visibility', label: 'visibility' },
  { key: 'password_hint', label: 'password' },
  { key: 'related_post_ids', label: 'related' },
  { key: 'content_json', label: 'content' }
]

function buildServerComparable(): Record<LocalConflictFieldKey, unknown> {
  const p = post.value
  // Normalise the server content through the SAME pass the local draft uses (see
  // `strippedContent`), otherwise an unedited draft that dropped a trailing empty
  // block or trimmed whitespace registers as a false-positive conflict. Keep
  // blockIds so `renderedBlockDiff` can still match blocks by id.
  const serverContent = p?.content_json ?? emptyDoc()
  return {
    title: p?.title ?? '',
    slug: p?.slug ?? '',
    summary: p?.summary ?? '',
    cover_image: p?.cover_image ?? '',
    category_ids: p?.category_ids ?? [],
    tag_ids: p?.tag_ids ?? [],
    visibility: p?.visibility ?? 'public',
    password_hint: p?.password_hint ?? '',
    related_post_ids: p?.related_post_ids ?? [],
    content_json: normalizeDocForSave(serverContent) ?? serverContent
  }
}

function buildLocalComparable(local: LocalDraftPayload): Record<LocalConflictFieldKey, unknown> {
  return {
    title: local.title ?? '',
    slug: local.slug ?? '',
    summary: local.summary ?? '',
    cover_image: local.cover_image ?? '',
    category_ids: local.category_ids ?? [],
    tag_ids: local.tag_ids ?? [],
    visibility: local.visibility ?? 'public',
    password_hint: local.password_hint ?? '',
    related_post_ids: local.related_post_ids ?? [],
    content_json: normalizeDocForSave(local.content_json ?? emptyDoc()) ?? emptyDoc()
  }
}

function changedLocalFields(local: LocalDraftPayload): string[] {
  const server = buildServerComparable()
  const localCmp = buildLocalComparable(local)
  return LOCAL_CONFLICT_FIELDS
    .filter((field) => localFieldDiffers(field.key, server[field.key], localCmp[field.key]))
    .map((field) => field.label)
}

function localFieldDiffers(field: LocalConflictFieldKey, serverValue: unknown, localValue: unknown): boolean {
  if (field === 'content_json') {
    return hasRenderedBlockChanges(serverValue as JsonContent, localValue as JsonContent)
  }

  return JSON.stringify(serverValue) !== JSON.stringify(localValue)
}

function localDraftDiffersFromServer(local: LocalDraftPayload): boolean {
  return changedLocalFields(local).length > 0
}

function applyLocalDraft() {
  const local = pendingLocalDraft.value
  if (local) {
    restoreLocalDraft(local, true)
  }
  localConflictOpen.value = false
  pendingLocalDraft.value = null
}

function restoreLocalDraft(local: LocalDraftPayload, markUnsaved: boolean) {
  Object.assign(form, {
    title: local.title ?? form.title,
    slug: local.slug ?? form.slug,
    summary: local.summary ?? form.summary,
    cover_image: local.cover_image ?? form.cover_image,
    category_ids: local.category_ids ?? form.category_ids,
    tag_ids: local.tag_ids ?? form.tag_ids,
    category_names: local.category_names ?? [],
    tag_names: local.tag_names ?? [],
    visibility: local.visibility ?? form.visibility,
    password: local.password ?? '',
    password_hint: local.password_hint ?? form.password_hint,
    related_post_ids: local.related_post_ids ?? form.related_post_ids,
    content: local.content_json ?? form.content
  })

  if (markUnsaved) {
    saveStatus.value = t('admin.editor.unsavedLocalChanges')
    saveStatusType.value = 'success'
  } else {
    savedDbSnapshot.value = serializeDbPayload()
  }
}

function discardLocalDraft() {
  clearLocalSave()
  localConflictOpen.value = false
  pendingLocalDraft.value = null
}

const localConflictChangedFields = computed(() => {
  const local = pendingLocalDraft.value
  return local ? changedLocalFields(local) : []
})
const localConflictServerText = computed(() => docToDiffText(post.value?.content_json ?? null))
const localConflictLocalText = computed(() => docToDiffText(pendingLocalDraft.value?.content_json ?? null))
const localConflictSavedAtLabel = computed(() => {
  const at = pendingLocalDraft.value?.savedAt
  return at ? formatAdminDateTime(at) : ''
})
const localConflictServerSavedAtLabel = computed(() => post.value?.updated_at ? formatAdminDateTime(post.value.updated_at) : '')

async function openVersionHistory() {
  rightPaneMode.value = 'versions'
  rightPaneCollapsed.value = false
  await loadVersions()
}

async function loadVersions() {
  const response = await fetchAdmin<{ versions: PostVersionRecord[] }>(`${apiPath.value}/versions`)
  versions.value = response.versions
}

async function selectVersion(version: PostVersionRecord) {
  selectedVersion.value = version
  selectedVersionDoc.value = null
  versionDetailPending.value = true
  try {
    const detail = await fetchAdmin<{ content_json: JsonContent }>(`${apiPath.value}/versions/${encodeURIComponent(version.version)}`)
    selectedVersionDoc.value = detail.content_json
  } finally {
    versionDetailPending.value = false
  }
}

async function showVersionDiff(version: PostVersionRecord) {
  versionHistoryOpen.value = true
  await selectVersion(version)
}

// Restore a snapshot into the local editor only. Persists to the DB only when
// the user clicks Update; matches the local-draft workflow.
async function restoreSelectedVersion(version?: PostVersionRecord) {
  const target = version ?? selectedVersion.value
  if (!target) return
  const detail = await fetchAdmin<{ content_json: JsonContent }>(`${apiPath.value}/versions/${encodeURIComponent(target.version)}`)
  form.content = detail.content_json
  versionHistoryOpen.value = false
  adminToast.success(t('admin.editor.versionsPanel.restoredLocal'))
}

async function restoreFromDiff() {
  if (selectedVersion.value) await restoreSelectedVersion(selectedVersion.value)
}

async function deleteSelectedVersion(version?: PostVersionRecord) {
  const target = version ?? selectedVersion.value
  if (!target) return
  await fetchAdmin(`${apiPath.value}/versions/${encodeURIComponent(target.version)}`, { method: 'DELETE' })
  if (selectedVersion.value?.version === target.version) {
    selectedVersion.value = null
    selectedVersionDoc.value = null
  }
  await loadVersions()
  adminToast.success('Version deleted')
}

function formatVersionDate(version: PostVersionRecord) {
  return version.datetime ? formatAdminDateTime(version.datetime) : version.version
}

// ─── PUBLISH / UPDATE (DB write) ─────────────────────────────────────────────
async function publishOrUpdate() {
  postSettingsOpen.value = true
}

async function confirmPublishOrUpdate() {
  const saved = await save('published', 'publish')
  if (saved) {
    postSettingsOpen.value = false
  }
}

async function save(nextStatus: PostStatus, action: 'save-db' | 'publish' | 'unpublish') {
  const wasPublished = currentStatus.value === 'published'
  savingAction.value = action
  saveStatus.value = t('admin.editor.saving')
  saveStatusType.value = 'success'

  try {
    const saved = await fetchAdmin<PostRecord>(apiPath.value, {
      method: 'PUT',
      body: {
        title: form.title,
        slug: form.slug,
        summary: form.summary,
        cover_image: form.cover_image,
        category_ids: form.category_ids,
        tag_ids: form.tag_ids,
        category_names: form.category_names,
        tag_names: form.tag_names,
        status: nextStatus,
        visibility: form.visibility,
        password: form.password,
        password_hint: form.password_hint,
        related_post_ids: form.related_post_ids,
        content_json: strippedContent()
      }
    })

    form.slug = saved.slug
    slugManuallyEdited.value = saved.slug !== slugifyTitle(form.title)
    currentStatus.value = saved.status === 'archived' ? 'draft' : saved.status
    form.category_ids = [...(saved.category_ids ?? form.category_ids)]
    form.tag_ids = [...(saved.tag_ids ?? form.tag_ids)]
    form.category_names = []
    form.tag_names = []
    form.visibility = saved.visibility ?? form.visibility
    form.password_hint = saved.password_hint ?? ''
    form.related_post_ids = [...(saved.related_post_ids ?? form.related_post_ids)]
    form.related_posts = [...(saved.related_posts ?? form.related_posts)]
    post.value = saved
    adminPostBreadcrumb.value = { id: saved.id, slug: saved.slug }
    savedDbSnapshot.value = serializeDbPayload()
    hasLoadedDbSnapshot.value = true
    clearLocalSave()
    await Promise.all([refreshCategories(), refreshTags()])

    const timeStr = formatTime(new Date())
    if (action === 'publish') {
      saveStatus.value = currentStatus.value === 'published' ? t('admin.editor.updatedAt', { time: timeStr }) : t('admin.editor.publishedAt', { time: timeStr })
    } else if (action === 'save-db') {
      saveStatus.value = t('admin.editor.savedToDbAt', { time: timeStr })
    } else if (action === 'unpublish') {
      saveStatus.value = t('admin.editor.unpublishedAt', { time: timeStr })
    }
    saveStatusType.value = 'success'
    adminToast.success(postSaveTitle(action, wasPublished))
    return true
  } catch (err: any) {
    adminToast.error(err, t('admin.editor.saveFailed'))
    saveStatus.value = t('admin.editor.saveFailed')
    saveStatusType.value = 'error'
    return false
  } finally {
    savingAction.value = null
  }
}

async function archivePost() {
  try {
    await fetchAdmin(apiPath.value, { method: 'DELETE' })
    adminToast.success(t('admin.editor.postArchived'))
    await navigateTo('/admin/posts')
  } catch (err: any) {
    adminToast.error(err, t('admin.editor.archiveFailed'))
  }
}

function postSaveTitle(action: 'save-db' | 'publish' | 'unpublish', wasPublished: boolean) {
  if (action === 'save-db') {
    return t('admin.editor.postSaved')
  }

  if (action === 'unpublish') {
    return t('admin.editor.postUnpublished')
  }

  return wasPublished ? t('admin.editor.postUpdated') : t('admin.editor.postPublished')
}

// 5-minute auto-save: triggers only when the page is mounted, when no manual
// save is already in flight, and only saves as draft (never publishes).
let autoSaveTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  // Restore local draft if available. When it diverges from the saved/published
  // version, surface a conflict diff and let the user choose instead of silently
  // overwriting the form content.
  const local = loadLocalSave()
  if (local && post.value) {
    if (localDraftDiffersFromServer(local)) {
      pendingLocalDraft.value = local
      localConflictOpen.value = true
    } else {
      restoreLocalDraft(local, false)
      clearLocalSave()
    }
  }

  autoSaveTimer = setInterval(() => {
    if (savingAction.value) return
    if (currentStatus.value === 'archived') return
    saveLocal()
  }, 5 * 60 * 1000)

  window.addEventListener('beforeunload', handleBeforeUnload)
})
onBeforeUnmount(() => {
  adminPostBreadcrumb.value = null
  if (autoSaveTimer) {
    clearInterval(autoSaveTimer)
    autoSaveTimer = null
  }

  window.removeEventListener('beforeunload', handleBeforeUnload)
})

onBeforeRouteLeave((to) => {
  if (bypassLeaveGuard.value || !needsLeaveDecision.value || savingAction.value === 'save-db') {
    return true
  }

  pendingLeavePath.value = to.fullPath
  leaveDialogOpen.value = true
  return false
})

function handleBeforeUnload(event: BeforeUnloadEvent) {
  if (bypassLeaveGuard.value || !needsLeaveDecision.value || savingAction.value === 'save-db') {
    return
  }

  event.preventDefault()
  event.returnValue = ''
}

function cancelLeave() {
  leaveDialogOpen.value = false
  pendingLeavePath.value = null
}

async function discardAndLeave() {
  if (isNewDraftShell.value) {
    await discardNewDraftShellAndLeave()
    return
  }

  clearLocalSave()
  await continueLeaveNavigation()
}

async function saveAndLeave() {
  const ok = await save(currentStatus.value, 'save-db')
  if (!ok) {
    return
  }

  keepNewDraftShell.value = true
  await continueLeaveNavigation()
}

async function discardNewDraftShellAndLeave() {
  savingAction.value = 'save-db'
  try {
    await fetchAdmin(apiPath.value, { method: 'DELETE' })
    clearLocalSave()
    await continueLeaveNavigation()
  } catch (err: any) {
    adminToast.error(err, t('admin.editor.archiveFailed'))
  } finally {
    savingAction.value = null
  }
}

async function continueLeaveNavigation() {
  const targetPath = pendingLeavePath.value
  leaveDialogOpen.value = false
  pendingLeavePath.value = null
  if (!targetPath) {
    return
  }

  bypassLeaveGuard.value = true
  try {
    await navigateTo(targetPath)
  } finally {
    bypassLeaveGuard.value = false
  }
}

function serializeDbPayload() {
  return JSON.stringify({
    title: form.title,
    slug: form.slug,
    summary: form.summary,
    cover_image: form.cover_image,
    category_ids: form.category_ids,
    tag_ids: form.tag_ids,
    category_names: form.category_names,
    tag_names: form.tag_names,
    visibility: form.visibility,
    password: form.password,
    password_hint: form.password_hint,
    related_post_ids: form.related_post_ids,
    content_json: comparableContent(),
    status: currentStatus.value
  })
}

// Content used for DB dirty-detection. Ignores blockId churn (server mints ids)
// on top of the save-time normalisation so an untouched post never looks dirty.
function comparableContent() {
  return normalizeDocForComparison(form.content) ?? form.content
}

// Content persisted to the DB / local draft: strips empty blocks (incl. nested)
// and trims edge whitespace, but keeps blockIds for stable server-side diffing.
function strippedContent() {
  return normalizeDocForSave(form.content) ?? form.content
}

function slugifyTitle(value: string) {
  return slugify(value)
}

function emptyDoc(): JsonContent {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [] }]
  }
}

function isEmptyDocContent(value: JsonContent | null | undefined) {
  const children = Array.isArray(value?.content) ? value.content : []
  if (children.length === 0) {
    return true
  }

  return children.every((child) => {
    if (child.type !== 'paragraph') {
      return false
    }
    return !Array.isArray(child.content) || child.content.length === 0
  })
}

function formatDate(value: string) {
  return formatAdminDateTime(value)
}

function formatTime(value: Date) {
  return formatAdminTime(value)
}

function fetchAdmin<T>(url: string, options: Record<string, unknown> = {}) {
  const method = String(options.method ?? 'GET').toUpperCase()
  const timeoutMs = method === 'GET' ? readFetchTimeoutMs : writeFetchTimeoutMs

  return sessionFetch<T>(url, {
    timeout: timeoutMs,
    ...options
  })
}

function statusLabel(status: PostStatus) {
  return t(`admin.posts.status.${status}`)
}

function onEditorTouchStart(event: TouchEvent) {
  if (!isMobileEditorSwipe()) return

  const touch = event.changedTouches[0]
  if (!touch) return

  editorTouchStart.value = { x: touch.clientX, y: touch.clientY }
}

function onEditorTouchEnd(event: TouchEvent) {
  const start = editorTouchStart.value
  editorTouchStart.value = null
  if (!start || !isMobileEditorSwipe()) return

  const touch = event.changedTouches[0]
  if (!touch) return

  const deltaX = touch.clientX - start.x
  const deltaY = touch.clientY - start.y
  if (Math.abs(deltaX) < 72 || Math.abs(deltaX) < Math.abs(deltaY) * 1.2) return

  const edgeSize = 56
  const fromLeftEdge = start.x <= edgeSize
  const fromRightEdge = start.x >= window.innerWidth - edgeSize

  if (deltaX > 0) {
    if (!rightPaneCollapsed.value) {
      rightPaneCollapsed.value = true
    }
    else if (fromLeftEdge) {
      editorStore.openInserter()
    }
    return
  }

  if (editorStore.inserterOpen) {
    editorStore.closeInserter()
  }
  else if (fromRightEdge) {
    rightPaneCollapsed.value = false
  }
}

function isMobileEditorSwipe() {
  return import.meta.client && window.matchMedia('(max-width: 767px)').matches
}
</script>

<style scoped>
.pb-editor-topbar {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.5rem 0.75rem;
}

.pb-editor-primary-row {
  display: contents;
}

.pb-editor-back {
  grid-column: 1;
}

.pb-editor-summary-row {
  grid-column: 2;
  min-width: 0;
}

.pb-editor-actions {
  grid-column: 3;
  display: flex;
  min-width: 0;
  flex-shrink: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 0.375rem;
}

.pb-content-frame {
  max-width: var(--pb-post-content-max-width);
}

.pb-editor-grid-shell {
  --pb-editor-gutter: 32px;
  --pb-editor-gap: 8px;
}

@media (max-width: 767px) {
  .pb-editor-topbar {
    display: flex;
    flex-direction: column;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.5rem;
  }

  .pb-editor-primary-row {
    display: flex;
    min-width: 0;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .pb-editor-back,
  .pb-editor-summary-row,
  .pb-editor-actions {
    grid-column: 1;
  }

  .pb-editor-summary-row {
    order: 1;
  }

  .pb-editor-actions {
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .pb-editor-primary-row {
    order: 2;
  }

  .pb-editor-grid-shell {
    --pb-editor-gutter: 0px;
    --pb-editor-gap: 0px;
  }
}

.pb-editor-row {
  display: grid;
  grid-template-columns: var(--pb-editor-gutter) minmax(0, 1fr) var(--pb-editor-gutter);
  column-gap: var(--pb-editor-gap);
  align-items: start;
}

.pb-editor-gutter {
  width: var(--pb-editor-gutter);
}
</style>
