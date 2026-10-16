<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" class="absolute inset-0 bg-black/40" :aria-label="t('admin.common.close')" @click="emit('close')" />
      <section class="relative flex max-h-[92vh] w-full max-w-5xl flex-col rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] shadow-[var(--pb-shadow-lg)]">
        <header class="flex items-center justify-between border-b border-[var(--pb-divider)] p-4">
          <h2 class="text-lg font-semibold text-[var(--pb-text)]">{{ t('admin.media.searchMedia') }}</h2>
          <UButton type="button" icon="i-lucide-x" color="neutral" variant="ghost" @click="emit('close')" />
        </header>

        <div class="border-b border-[var(--pb-divider)] px-4 pt-3">
          <div class="flex flex-wrap gap-1 rounded-[var(--pb-radius-md)] bg-[var(--pb-surface-subtle)] p-1">
            <button
              v-for="tab in tabs"
              :key="tab.value"
              type="button"
              class="rounded px-3 py-1.5 text-sm font-medium transition"
              :class="activeTab === tab.value ? 'bg-[var(--pb-card-bg)] text-[var(--pb-text)] shadow-[var(--pb-shadow-sm)]' : 'text-[var(--pb-text-muted)] hover:text-[var(--pb-text)]'"
              @click="activeTab = tab.value"
            >
              {{ tab.label }}
            </button>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <section v-if="activeTab === 'simple'" class="space-y-4">
            <UFormField :label="t('admin.media.search')">
              <UInput v-model="form.search" icon="i-lucide-search" placeholder="example.txt" @keydown.enter.prevent="applySearch" />
            </UFormField>
            <p class="text-xs text-[var(--pb-text-subtle)]">{{ t('admin.media.simpleSearchHint') }}</p>

            <div class="flex flex-wrap gap-4 rounded-[var(--pb-radius-card-inner)] border border-[var(--pb-divider)] p-3">
              <label class="flex items-center gap-2 text-sm text-[var(--pb-text-muted)]">
                <input v-model="form.search_regex" type="checkbox" class="rounded border-[var(--pb-border-strong)]">
                <span>{{ t('admin.media.regex') }}</span>
              </label>
              <label class="flex items-center gap-2 text-sm text-[var(--pb-text-muted)]">
                <input v-model="form.case_insensitive" type="checkbox" class="rounded border-[var(--pb-border-strong)]">
                <span>{{ t('admin.media.caseInsensitive') }}</span>
              </label>
              <label class="flex items-center gap-2 text-sm text-[var(--pb-text-muted)]">
                <input v-model="form.orphan" type="checkbox" class="rounded border-[var(--pb-border-strong)]">
                <span>{{ t('admin.media.orphanOnly') }}</span>
              </label>
            </div>
          </section>

          <section v-else-if="activeTab === 'advanced'" class="space-y-4">
            <div class="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <UFormField :label="t('admin.media.fileName')">
                <UInput v-model="form.file_name" icon="i-lucide-file-search" placeholder="holiday|report" />
              </UFormField>
              <UFormField :label="t('admin.media.fileExtension')">
                <UInput v-model="form.extension" icon="i-lucide-file-type" placeholder="pdf" />
              </UFormField>
              <UFormField :label="t('admin.media.comments')">
                <UInput v-model="form.comment" icon="i-lucide-message-square" placeholder="draft" />
              </UFormField>
              <UFormField :label="t('admin.media.tags')">
                <div class="rounded-[var(--pb-radius-md)] border border-[var(--pb-border-strong)] px-2 py-1.5">
                  <MediaTagInput v-model="form.tags" />
                </div>
              </UFormField>
              <UFormField :label="t('admin.media.type')">
                <USelect v-model="form.type" :items="typeItems" :content="selectContent" :ui="selectUi" />
              </UFormField>
              <UFormField :label="t('admin.media.from')">
                <UInput v-model="form.uploaded_from" type="date" />
              </UFormField>
              <UFormField :label="t('admin.media.to')">
                <UInput v-model="form.uploaded_to" type="date" />
              </UFormField>
            </div>

            <div class="rounded-[var(--pb-radius-card-inner)] border border-[var(--pb-divider)] p-3">
              <div class="mb-2 text-sm font-medium text-[var(--pb-text)]">{{ t('admin.media.fileSize') }}</div>
              <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
                <UFormField :label="t('admin.media.sizeMin')">
                  <UInput v-model="form.size_min" type="number" min="0" step="any" icon="i-lucide-minimize-2" :placeholder="t('admin.media.sizeAny')" />
                </UFormField>
                <UFormField :label="t('admin.media.sizeMax')">
                  <UInput v-model="form.size_max" type="number" min="0" step="any" icon="i-lucide-maximize-2" :placeholder="t('admin.media.sizeAny')" />
                </UFormField>
                <UFormField :label="t('admin.media.sizeUnit')">
                  <USelect v-model="form.size_unit" :items="sizeUnitItems" :content="selectContent" :ui="selectUi" />
                </UFormField>
              </div>
            </div>

            <div class="flex flex-wrap gap-4 rounded-[var(--pb-radius-card-inner)] border border-[var(--pb-divider)] p-3">
              <label class="flex items-center gap-2 text-sm text-[var(--pb-text-muted)]">
                <input v-model="form.search_regex" type="checkbox" class="rounded border-[var(--pb-border-strong)]">
                <span>{{ t('admin.media.regex') }}</span>
              </label>
              <label class="flex items-center gap-2 text-sm text-[var(--pb-text-muted)]">
                <input v-model="form.case_insensitive" type="checkbox" class="rounded border-[var(--pb-border-strong)]">
                <span>{{ t('admin.media.caseInsensitive') }}</span>
              </label>
              <label class="flex items-center gap-2 text-sm text-[var(--pb-text-muted)]">
                <input v-model="form.orphan" type="checkbox" class="rounded border-[var(--pb-border-strong)]">
                <span>{{ t('admin.media.orphanOnly') }}</span>
              </label>
            </div>
          </section>

          <section v-else-if="activeTab === 'favorites'" class="space-y-3">
            <div
              v-for="entry in favoriteSearches"
              :key="entry.id"
              class="flex flex-col gap-3 rounded-[var(--pb-radius-card-inner)] border border-[var(--pb-divider)] bg-[var(--pb-card-bg)] p-3 md:flex-row md:items-center"
            >
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-[var(--pb-text)]">{{ entry.name }}</div>
                <div class="mt-1 truncate text-xs text-[var(--pb-text-subtle)]">{{ savedSummary(entry.form) }}</div>
              </div>
              <div class="flex shrink-0 gap-2">
                <UButton type="button" size="xs" color="neutral" variant="soft" icon="i-lucide-pencil" @click="loadSavedSearch(entry)">{{ t('admin.media.load') }}</UButton>
                <UButton type="button" size="xs" icon="i-lucide-search" @click="applySavedSearch(entry)">{{ t('admin.media.search') }}</UButton>
                <UButton type="button" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="deleteFavorite(entry.id)" />
              </div>
            </div>
            <div v-if="!favoriteSearches.length" class="rounded-[var(--pb-radius-card-inner)] border border-dashed border-[var(--pb-border-strong)] py-10 text-center text-sm text-[var(--pb-text-subtle)]">{{ t('admin.media.noFavoriteSearches') }}</div>
          </section>

          <section v-else class="space-y-3">
            <div
              v-for="entry in recentSearches"
              :key="entry.id"
              class="flex flex-col gap-3 rounded-[var(--pb-radius-card-inner)] border border-[var(--pb-divider)] bg-[var(--pb-card-bg)] p-3 md:flex-row md:items-center"
            >
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-medium text-[var(--pb-text)]">{{ entry.name }}</div>
                <div class="mt-1 truncate text-xs text-[var(--pb-text-subtle)]">{{ savedSummary(entry.form) }}</div>
              </div>
              <div class="flex shrink-0 gap-2">
                <UButton type="button" size="xs" color="neutral" variant="soft" icon="i-lucide-pencil" @click="loadSavedSearch(entry)">{{ t('admin.media.load') }}</UButton>
                <UButton type="button" size="xs" icon="i-lucide-search" @click="applySavedSearch(entry)">{{ t('admin.media.search') }}</UButton>
                <UButton type="button" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" @click="deleteRecent(entry.id)" />
              </div>
            </div>
            <div v-if="!recentSearches.length" class="rounded-[var(--pb-radius-card-inner)] border border-dashed border-[var(--pb-border-strong)] py-10 text-center text-sm text-[var(--pb-text-subtle)]">{{ t('admin.media.noRecentSearches') }}</div>
          </section>
        </div>

        <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--pb-divider)] p-4">
          <UButton type="button" icon="i-lucide-star" color="neutral" variant="soft" @click="openFavoriteDialog">{{ t('admin.media.saveFavorite') }}</UButton>
          <UButton type="button" color="neutral" variant="ghost" @click="resetForm">{{ t('admin.media.reset') }}</UButton>
          <UButton type="button" icon="i-lucide-search" @click="applySearch">{{ t('admin.media.search') }}</UButton>
        </footer>
      </section>

      <div v-if="favoriteDialogOpen" class="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <button type="button" class="absolute inset-0 bg-black/30" :aria-label="t('admin.common.close')" @click="favoriteDialogOpen = false" />
        <form class="relative w-full max-w-md rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] p-4 shadow-[var(--pb-shadow-lg)]" @submit.prevent="confirmSaveFavorite">
          <h3 class="text-base font-semibold text-[var(--pb-text)]">{{ t('admin.media.saveFavoriteSearch') }}</h3>
          <UFormField :label="t('admin.media.name')" class="mt-4">
            <UInput v-model="favoriteName" icon="i-lucide-star" autofocus />
          </UFormField>
          <div class="mt-4 flex justify-end gap-2">
            <UButton type="button" color="neutral" variant="ghost" @click="favoriteDialogOpen = false">{{ t('admin.media.cancel') }}</UButton>
            <UButton type="submit" icon="i-lucide-check">{{ t('admin.media.save') }}</UButton>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import MediaTagInput from '~/components/admin/media/MediaTagInput.vue'

type SearchTab = 'simple' | 'advanced' | 'favorites' | 'recent'

export interface MediaSearchPayload {
  search: string
  file_name: string
  extension: string
  comment: string
  tags: string[]
  type: string
  tag: string
  uploaded_from: string
  uploaded_to: string
  orphan: boolean
  search_regex: boolean
  case_insensitive: boolean
  filename_regex: string
  filename_regex_case_insensitive: boolean
  size_min: string
  size_max: string
  size_unit: SizeUnit
}

interface SavedSearch {
  id: string
  name: string
  form: SearchForm
}

interface SearchForm {
  search: string
  file_name: string
  extension: string
  comment: string
  tags: string[]
  type: string
  uploaded_from: string
  uploaded_to: string
  orphan: boolean
  search_regex: boolean
  case_insensitive: boolean
  size_min: string
  size_max: string
  size_unit: SizeUnit
}

type SizeUnit = 'KB' | 'MB' | 'GB'

const props = defineProps<{
  modelValue: MediaSearchPayload
}>()

const emit = defineEmits<{
  close: []
  apply: [value: MediaSearchPayload]
}>()

const { t } = useI18n()

const recentKey = 'pandablog-media-recent-searches'
const favoriteKey = 'pandablog-media-favorite-searches'
const tabKey = 'pandablog-media-search-active-tab'
const activeTab = ref<SearchTab>('simple')
const favoriteDialogOpen = ref(false)
const favoriteName = ref('')
const recentSearches = ref<SavedSearch[]>(readSaved(recentKey))
const favoriteSearches = ref<SavedSearch[]>(readSaved(favoriteKey))
const form = reactive<SearchForm>(payloadToForm(props.modelValue))

if (typeof localStorage !== 'undefined') {
  const savedTab = localStorage.getItem(tabKey)
  if (savedTab === 'simple' || savedTab === 'advanced' || savedTab === 'favorites' || savedTab === 'recent') {
    activeTab.value = savedTab
  }
}

watch(activeTab, (value) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(tabKey, value)
  }
})

const tabs = computed<Array<{ label: string; value: SearchTab }>>(() => [
  { label: t('admin.media.simpleSearch'), value: 'simple' },
  { label: t('admin.media.advancedSearch'), value: 'advanced' },
  { label: t('admin.media.favoriteSearches'), value: 'favorites' },
  { label: t('admin.media.recentSearches'), value: 'recent' }
])

const selectContent = { side: 'bottom' as const, sideOffset: 6, collisionPadding: 16 }
const selectUi = { content: 'z-[80]' }

const typeItems = computed(() => [
  { label: t('admin.media.typeAll'), value: 'all' },
  { label: t('admin.media.typeImages'), value: 'image' },
  { label: t('admin.media.typeVideos'), value: 'video' },
  { label: t('admin.media.typeAudio'), value: 'audio' },
  { label: t('admin.media.typeDocuments'), value: 'document' },
  { label: t('admin.media.typeArchives'), value: 'archive' },
  { label: t('admin.media.typeOther'), value: 'other' }
])

const sizeUnitItems = [
  { label: 'KB', value: 'KB' },
  { label: 'MB', value: 'MB' },
  { label: 'GB', value: 'GB' }
]

function normalizeSizeUnit(value: unknown): SizeUnit {
  return value === 'MB' || value === 'GB' ? value : 'KB'
}

function cleanString(value: unknown) {
  return String(value ?? '').trim()
}

function payloadToForm(payload: Partial<MediaSearchPayload>): SearchForm {
  const tags = Array.isArray(payload.tags) && payload.tags.length
    ? payload.tags
    : payload.tag
      ? [payload.tag]
      : []

  return {
    search: payload.search || '',
    file_name: payload.file_name || '',
    extension: payload.extension || '',
    comment: payload.comment || '',
    tags,
    type: payload.type || 'all',
    uploaded_from: payload.uploaded_from || '',
    uploaded_to: payload.uploaded_to || '',
    orphan: payload.orphan || false,
    search_regex: payload.search_regex || false,
    case_insensitive: payload.case_insensitive !== false,
    size_min: payload.size_min || '',
    size_max: payload.size_max || '',
    size_unit: normalizeSizeUnit(payload.size_unit)
  }
}

function applySearch() {
  const payload = formToPayload()
  addRecent(payload)
  emit('apply', payload)
}

function formToPayload(): MediaSearchPayload {
  return payloadFromForm(form)
}

function payloadFromForm(value: SearchForm): MediaSearchPayload {
  return {
    search: cleanString(value.search),
    file_name: cleanString(value.file_name),
    extension: cleanString(value.extension),
    comment: cleanString(value.comment),
    tags: [...value.tags],
    type: value.type,
    tag: value.tags[0] || '',
    uploaded_from: value.uploaded_from,
    uploaded_to: value.uploaded_to,
    orphan: value.orphan,
    search_regex: value.search_regex,
    case_insensitive: value.case_insensitive,
    filename_regex: '',
    filename_regex_case_insensitive: value.case_insensitive,
    size_min: cleanString(value.size_min),
    size_max: cleanString(value.size_max),
    size_unit: normalizeSizeUnit(value.size_unit)
  }
}

function openFavoriteDialog() {
  favoriteName.value = searchLabel(formToPayload())
  favoriteDialogOpen.value = true
}

function confirmSaveFavorite() {
  const name = favoriteName.value.trim()
  if (!name) return
  const entry = makeSavedSearch(name, formToPayload())
  favoriteSearches.value = [entry, ...favoriteSearches.value.filter((item) => item.name !== name)].slice(0, 20)
  writeSaved(favoriteKey, favoriteSearches.value)
  favoriteDialogOpen.value = false
  activeTab.value = 'favorites'
}

function addRecent(payload: MediaSearchPayload) {
  const key = payloadKey(payload)
  const entry = makeSavedSearch(searchLabel(payload), payload)
  recentSearches.value = [entry, ...recentSearches.value.filter((item) => payloadKey(payloadFromForm(item.form)) !== key)].slice(0, 10)
  writeSaved(recentKey, recentSearches.value)
}

function loadSavedSearch(entry: SavedSearch) {
  Object.assign(form, cloneForm(entry.form))
  activeTab.value = 'simple'
}

function applySavedSearch(entry: SavedSearch) {
  Object.assign(form, cloneForm(entry.form))
  applySearch()
}

function deleteFavorite(id: string) {
  favoriteSearches.value = favoriteSearches.value.filter((entry) => entry.id !== id)
  writeSaved(favoriteKey, favoriteSearches.value)
}

function deleteRecent(id: string) {
  recentSearches.value = recentSearches.value.filter((entry) => entry.id !== id)
  writeSaved(recentKey, recentSearches.value)
}

function resetForm() {
  Object.assign(form, payloadToForm(defaultPayload()))
  activeTab.value = 'simple'
}

function makeSavedSearch(name: string, payload: MediaSearchPayload): SavedSearch {
  return { id: uid(), name, form: payloadToForm(payload) }
}

function searchLabel(payload: MediaSearchPayload) {
  return payload.search || payload.file_name || payload.extension || payload.comment || payload.tags[0] || payload.type || t('admin.media.mediaSearchDefault')
}

function savedSummary(savedForm: SearchForm) {
  const parts = [
    savedForm.search ? t('admin.media.summarySearch', { value: savedForm.search }) : '',
    savedForm.file_name ? t('admin.media.summaryName', { value: savedForm.file_name }) : '',
    savedForm.extension ? t('admin.media.summaryExtension', { value: savedForm.extension }) : '',
    savedForm.comment ? t('admin.media.summaryComments', { value: savedForm.comment }) : '',
    savedForm.tags.length ? t('admin.media.summaryTags', { value: savedForm.tags.join(', ') }) : '',
    savedForm.uploaded_from ? t('admin.media.summaryFrom', { value: savedForm.uploaded_from }) : '',
    savedForm.uploaded_to ? t('admin.media.summaryTo', { value: savedForm.uploaded_to }) : '',
    savedForm.type && savedForm.type !== 'all' ? t('admin.media.summaryType', { value: savedForm.type }) : '',
    savedForm.size_min || savedForm.size_max ? t('admin.media.summarySize', { value: `${savedForm.size_min || '0'}–${savedForm.size_max || '∞'} ${savedForm.size_unit}` }) : '',
    savedForm.search_regex ? t('admin.media.regex') : ''
  ].filter(Boolean)

  return parts.join(' | ') || t('admin.media.allMedia')
}

function payloadKey(payload: MediaSearchPayload) {
  return JSON.stringify(payload)
}

function defaultPayload(): MediaSearchPayload {
  return {
    search: '',
    file_name: '',
    extension: '',
    comment: '',
    tags: [],
    type: 'all',
    tag: '',
    uploaded_from: '',
    uploaded_to: '',
    orphan: false,
    search_regex: false,
    case_insensitive: true,
    filename_regex: '',
    filename_regex_case_insensitive: true,
    size_min: '',
    size_max: '',
    size_unit: 'KB'
  }
}

function readSaved(key: string): SavedSearch[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]') as Array<Partial<SavedSearch>>
    return Array.isArray(parsed)
      ? parsed
        .filter((entry) => entry && typeof entry.name === 'string' && entry.form)
        .map((entry) => ({
          id: typeof entry.id === 'string' ? entry.id : uid(),
          name: entry.name || t('admin.media.mediaSearchDefault'),
          form: normalizeForm(entry.form as Partial<SearchForm>)
        }))
      : []
  } catch {
    return []
  }
}

function writeSaved(key: string, value: SavedSearch[]) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(key, JSON.stringify(value))
  }
}

function normalizeForm(value: Partial<SearchForm>): SearchForm {
  const base = payloadToForm(defaultPayload())

  return {
    ...base,
    ...value,
    tags: Array.isArray(value.tags) ? value.tags : [],
    // Older saved searches may hold numbers; the size inputs are string-bound.
    size_min: value.size_min === undefined || value.size_min === null ? base.size_min : String(value.size_min),
    size_max: value.size_max === undefined || value.size_max === null ? base.size_max : String(value.size_max),
    case_insensitive: value.case_insensitive !== false
  }
}

function cloneForm(value: SearchForm): SearchForm {
  return JSON.parse(JSON.stringify(value)) as SearchForm
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}
</script>
