<template>
  <section class="grid gap-6">
    <header class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
      <div>
        <p class="text-sm font-medium uppercase tracking-wider text-[var(--pb-primary)]">{{ t('admin.words.eyebrow') }}</p>
        <h1 class="mt-1 text-3xl font-semibold tracking-normal text-[var(--pb-text)]">{{ t('admin.words.title') }}</h1>
        <p class="mt-1 text-sm text-[var(--pb-text-muted)]">{{ t('admin.words.description') }}</p>
      </div>
      <UButton icon="i-lucide-plus" @click="openCreate">{{ t('admin.words.newWord') }}</UButton>
    </header>

    <UAlert v-if="error" color="error" icon="i-lucide-circle-alert" :title="t('admin.words.loadFailed')" />

    <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex flex-1 flex-col gap-2 sm:flex-row">
        <UInput v-model="query" :placeholder="t('admin.words.searchPlaceholder')" icon="i-lucide-search" class="w-full sm:max-w-xs" />
        <USelect v-model="status" :items="statusItems" class="w-full sm:w-40" />
      </div>
      <p class="text-xs text-[var(--pb-text-subtle)]">{{ filteredWords.length }}</p>
    </div>

    <div class="overflow-hidden rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] shadow-[var(--pb-shadow-sm)]">
      <div v-if="pending" class="grid gap-3 p-5">
        <USkeleton v-for="index in 5" :key="index" class="h-14" />
      </div>

      <div v-else-if="filteredWords.length" class="overflow-x-auto">
        <table class="w-full border-collapse text-left text-sm">
          <thead class="bg-[var(--pb-surface-subtle)] text-xs uppercase tracking-wider text-[var(--pb-text-subtle)]">
            <tr>
              <th class="px-4 py-3 font-medium">{{ t('admin.words.headword') }}</th>
              <th class="px-4 py-3 font-medium">{{ t('admin.words.senses') }}</th>
              <th class="px-4 py-3 font-medium">{{ t('admin.words.updated') }}</th>
              <th class="px-4 py-3 text-right font-medium">{{ t('admin.common.actions') }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--pb-divider)]">
            <tr v-for="word in filteredWords" :key="word.id" class="hover:bg-[var(--pb-card-bg-hover)]">
              <td class="max-w-xs px-4 py-3">
                <div class="flex min-w-0 flex-wrap items-baseline gap-2">
                  <span class="truncate font-[var(--pb-font-display)] text-lg font-semibold text-[var(--pb-text)]">{{ word.headword }}</span>
                  <UBadge v-if="word.archived" color="warning" variant="subtle" size="xs">{{ t('admin.words.archivedBadge') }}</UBadge>
                </div>
                <div v-if="word.pronunciation" class="mt-0.5 truncate text-xs text-[var(--pb-text-subtle)]">{{ word.pronunciation }}</div>
              </td>
              <td class="px-4 py-3">
                <span class="text-[var(--pb-text)]">{{ word.senses.length }}</span>
                <div class="mt-0.5 flex flex-wrap gap-1">
                  <UBadge v-for="part in partsOfSpeech(word)" :key="part" color="primary" variant="subtle" size="xs">{{ part }}</UBadge>
                </div>
              </td>
              <td class="px-4 py-3 text-[var(--pb-text-muted)]">{{ formatDate(word.updated_at) }}</td>
              <td class="whitespace-nowrap px-4 py-3 text-right">
                <UButton icon="i-lucide-pencil" variant="ghost" color="neutral" size="sm" @click="openEdit(word)">
                  {{ t('admin.common.edit') }}
                </UButton>
                <UButton
                  v-if="word.archived"
                  icon="i-lucide-archive-restore"
                  variant="ghost"
                  color="primary"
                  size="sm"
                  :loading="restoringId === word.id"
                  @click="restoreWord(word)"
                >
                  {{ t('admin.words.restore') }}
                </UButton>
                <UButton
                  v-else
                  icon="i-lucide-archive"
                  variant="ghost"
                  color="error"
                  size="sm"
                  @click="requestArchive(word)"
                >
                  {{ t('admin.words.archive') }}
                </UButton>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <UEmpty
        v-else
        icon="i-lucide-book-marked"
        :title="query.trim() ? t('admin.words.noMatchesTitle') : t('admin.words.noWordsTitle')"
        :description="query.trim() ? t('admin.words.noMatchesDescription') : t('admin.words.noWordsDescription')"
        class="py-12"
      />
    </div>

    <UModal v-model:open="editorOpen" :ui="{ content: 'w-[calc(100vw-1rem)] max-w-3xl sm:w-[calc(100vw-2rem)]' }">
      <template #content>
        <div class="p-5">
          <h2 class="text-xl font-semibold text-[var(--pb-text)]">
            {{ editingWord ? t('admin.words.editWord') : t('admin.words.newWord') }}
          </h2>
          <p class="mt-1 text-sm text-[var(--pb-text-muted)]">{{ t('admin.words.editorDescription') }}</p>

          <div class="mt-5">
            <WordForm
              :key="editingWord?.id ?? 'new'"
              :word="editingWord"
              :saving="saving"
              @submit="saveWord"
              @cancel="closeEditor"
            />
          </div>
        </div>
      </template>
    </UModal>

    <AdminConfirmActionDialog
      :open="archiveDialogOpen"
      :title="t('admin.words.archiveTitle')"
      :description="archiveDialogDescription"
      :confirm-label="t('admin.words.archive')"
      confirm-color="error"
      :loading="Boolean(archivingId)"
      @update:open="(value) => { if (!value) closeArchiveDialog() }"
      @cancel="closeArchiveDialog"
      @confirm="confirmArchive"
    />
  </section>
</template>

<script setup lang="ts">
import type { WordInput, WordRecord } from '~/types/word'
import WordForm from '~/components/admin/words/WordForm.vue'

definePageMeta({ layout: 'admin' })

const { t, locale } = useI18n()
const route = useRoute()
const router = useRouter()
const adminToast = useAdminToast()

const { data, pending, error, refresh } = await useAsyncData('admin-words', () =>
  $fetch<{ words: WordRecord[] }>('/api/admin/words', {
    params: { status: 'all', limit: 500 }
  })
)

const words = computed(() => data.value?.words ?? [])
const query = ref('')
const status = ref<'active' | 'archived' | 'all'>('active')
const statusItems = computed(() => [
  { label: t('admin.words.statusActive'), value: 'active' },
  { label: t('admin.words.statusArchived'), value: 'archived' },
  { label: t('admin.words.statusAll'), value: 'all' }
])

const editorOpen = ref(false)
const editingWord = ref<WordRecord | null>(null)
const saving = ref(false)
const archivingId = ref('')
const restoringId = ref('')
const archiveDialogOpen = ref(false)
const pendingArchive = ref<WordRecord | null>(null)
const editQueryHandled = ref(false)

const filteredWords = computed(() => {
  const needle = query.value.trim().toLowerCase()
  return words.value.filter((word) => {
    if (status.value === 'active' && word.archived) return false
    if (status.value === 'archived' && !word.archived) return false
    if (!needle) return true
    return [
      word.headword,
      word.pronunciation ?? '',
      ...word.senses.flatMap(sense => [sense.partOfSpeech, sense.definition])
    ].join(' ').toLowerCase().includes(needle)
  })
})

const archiveDialogDescription = computed(() => pendingArchive.value
  ? t('admin.words.archiveDescription', { name: pendingArchive.value.headword })
  : t('admin.words.archiveTitle')
)

watch(data, () => {
  if (editQueryHandled.value) return
  const editId = String(route.query.edit ?? '')
  if (!editId) return
  const word = words.value.find(item => item.id === editId || item.id === `word:${editId}`)
  editQueryHandled.value = true
  if (word) {
    status.value = 'all'
    openEdit(word)
  }
}, { immediate: true })

function openCreate() {
  editingWord.value = null
  editorOpen.value = true
  void syncEditQuery(null)
}

function openEdit(word: WordRecord) {
  editingWord.value = word
  editorOpen.value = true
  void syncEditQuery(word.id)
}

function closeEditor() {
  if (saving.value) return
  editorOpen.value = false
  editingWord.value = null
  void syncEditQuery(null)
}

async function saveWord(payload: WordInput) {
  saving.value = true
  try {
    if (editingWord.value) {
      await $fetch(`/api/admin/words/${encodeURIComponent(editingWord.value.id)}`, {
        method: 'PUT',
        body: payload
      })
      adminToast.success(t('admin.words.saved'))
    } else {
      await $fetch('/api/admin/words', {
        method: 'POST',
        body: payload
      })
      adminToast.success(t('admin.words.created'))
    }
    editorOpen.value = false
    editingWord.value = null
    await syncEditQuery(null)
    await refresh()
  } catch (err) {
    adminToast.error(err, t('admin.words.saveFailed'))
  } finally {
    saving.value = false
  }
}

function requestArchive(word: WordRecord) {
  pendingArchive.value = word
  archiveDialogOpen.value = true
}

function closeArchiveDialog() {
  if (archivingId.value) return
  archiveDialogOpen.value = false
  pendingArchive.value = null
}

async function confirmArchive() {
  const word = pendingArchive.value
  if (!word) {
    closeArchiveDialog()
    return
  }

  archivingId.value = word.id
  try {
    await $fetch(`/api/admin/words/${encodeURIComponent(word.id)}`, { method: 'DELETE' })
    archiveDialogOpen.value = false
    pendingArchive.value = null
    await refresh()
    adminToast.success(t('admin.words.archived'))
  } catch (err) {
    adminToast.error(err, t('admin.words.archiveFailed'))
  } finally {
    archivingId.value = ''
  }
}

async function restoreWord(word: WordRecord) {
  restoringId.value = word.id
  try {
    await $fetch(`/api/admin/words/${encodeURIComponent(word.id)}`, {
      method: 'PUT',
      body: wordPayload(word, false)
    })
    await refresh()
    adminToast.success(t('admin.words.restored'))
  } catch (err) {
    adminToast.error(err, t('admin.words.restoreFailed'))
  } finally {
    restoringId.value = ''
  }
}

function wordPayload(word: WordRecord, archived: boolean) {
  return {
    headword: word.headword,
    language: word.language,
    pronunciation: word.pronunciation ?? '',
    archived,
    senses: word.senses.map(sense => ({
      id: sense.id,
      partOfSpeech: sense.partOfSpeech,
      definition: sense.definition,
      example: sense.example ?? '',
      note: sense.note ?? '',
      translations: sense.translations
    }))
  }
}

function partsOfSpeech(word: WordRecord) {
  return [...new Set(word.senses.map(sense => sense.partOfSpeech).filter(Boolean))].slice(0, 4)
}

function formatDate(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '-'
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(date)
}

async function syncEditQuery(id: string | null) {
  const query = { ...route.query }
  if (id) {
    query.edit = id
  } else {
    delete query.edit
  }
  await router.replace({ query })
}

</script>
