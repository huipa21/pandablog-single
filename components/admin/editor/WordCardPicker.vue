<template>
  <Teleport to="body">
    <Transition name="word-card-picker">
      <div
        v-if="open"
        class="pointer-events-auto fixed inset-0 z-[1250] flex items-center justify-center p-2 sm:p-4"
        @wheel.self.prevent
        @touchmove.self.prevent
      >
        <button
          type="button"
          class="absolute inset-0 bg-black/50"
          :aria-label="t('admin.common.close')"
          @click="close"
        />
        <section
          role="dialog"
          aria-modal="true"
          :aria-label="t('admin.editor.wordCard.pickerTitle')"
          class="relative flex max-h-[calc(100dvh-1rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] shadow-[var(--pb-shadow-lg)] sm:max-h-[88vh]"
        >
          <header class="flex items-start justify-between gap-3 border-b border-[var(--pb-divider)] px-4 py-3">
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-[var(--pb-text)]">{{ t('admin.editor.wordCard.pickerTitle') }}</h2>
              <p class="text-xs text-[var(--pb-text-subtle)]">{{ t('admin.editor.wordCard.pickerDescription') }}</p>
            </div>
            <UButton type="button" icon="i-lucide-x" size="xs" color="neutral" variant="ghost" :aria-label="t('admin.common.close')" @click="close" />
          </header>

          <div class="grid min-h-0 flex-1 overflow-hidden md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div class="flex min-h-0 min-w-0 flex-col border-b border-[var(--pb-divider)] md:border-b-0 md:border-r">
              <div class="border-b border-[var(--pb-divider)] p-3">
                <UInput v-model="query" :placeholder="t('admin.editor.wordCard.searchPlaceholder')" icon="i-lucide-search" autofocus />
              </div>

              <div class="min-h-0 flex-1 overflow-y-auto p-2">
                <div v-if="loading" class="grid gap-2 p-2">
                  <USkeleton v-for="index in 5" :key="index" class="h-12" />
                </div>

                <ul v-else-if="filteredWords.length" class="grid gap-1">
                  <li v-for="item in filteredWords" :key="item.id">
                    <button
                      type="button"
                      class="flex w-full items-start gap-2 rounded-[var(--pb-radius-md)] px-2.5 py-2 text-left transition-colors"
                      :class="item.id === selectedId ? 'bg-[var(--pb-selected-bg)] text-[var(--pb-text)]' : 'text-[var(--pb-text-muted)] hover:bg-[var(--pb-surface-subtle)]'"
                      @click="selectWord(item)"
                    >
                      <UIcon :name="item.id === selectedId ? 'i-lucide-check-circle-2' : 'i-lucide-book-marked'" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span class="min-w-0 flex-1">
                        <span class="flex min-w-0 items-baseline gap-2">
                          <span class="truncate font-semibold text-[var(--pb-text)]">{{ item.headword }}</span>
                          <span v-if="item.pronunciation" class="truncate text-xs text-[var(--pb-text-subtle)]">{{ item.pronunciation }}</span>
                        </span>
                        <span class="mt-0.5 block truncate text-xs text-[var(--pb-text-subtle)]">
                          {{ t('admin.editor.wordCard.senseCount', { count: item.senses.length }) }}
                        </span>
                      </span>
                    </button>
                  </li>
                </ul>

                <div v-else-if="loadError" class="grid gap-2 p-4 text-center text-sm text-[var(--pb-text-subtle)]">
                  <p>{{ t('admin.editor.wordCard.loadFailed') }}</p>
                  <UButton type="button" size="xs" variant="soft" icon="i-lucide-refresh-cw" @click="initialize">
                    {{ t('admin.common.retry') }}
                  </UButton>
                </div>

                <div v-else-if="query.trim()" class="p-4 text-center text-sm text-[var(--pb-text-subtle)]">
                  {{ t('admin.editor.wordCard.noMatches') }}
                </div>

                <div v-else class="grid gap-3 p-4 text-center text-sm text-[var(--pb-text-subtle)]">
                  <p>{{ t('admin.editor.wordCard.noWords') }}</p>
                  <UButton to="/admin/words" target="_blank" size="xs" variant="soft" icon="i-lucide-plus">
                    {{ t('admin.editor.wordCard.manageWords') }}
                  </UButton>
                </div>
              </div>
            </div>

            <div class="min-h-0 min-w-0 overflow-y-auto p-4">
              <template v-if="selectedWord">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <div class="min-w-0">
                    <p class="text-xs font-semibold uppercase tracking-wider text-[var(--pb-primary)]">{{ languageName(selectedWord.language) }}</p>
                    <h3 class="mt-1 break-words font-[var(--pb-font-display)] text-2xl font-semibold text-[var(--pb-text)]">{{ selectedWord.headword }}</h3>
                    <p v-if="selectedWord.pronunciation" class="mt-0.5 text-sm text-[var(--pb-text-muted)]">{{ selectedWord.pronunciation }}</p>
                  </div>
                  <UButton to="/admin/words" target="_blank" size="xs" color="neutral" variant="ghost" icon="i-lucide-pencil">
                    {{ t('admin.editor.wordCard.editWord') }}
                  </UButton>
                </div>

                <div class="mt-4 space-y-2">
                  <div class="flex items-center justify-between gap-2">
                    <h4 class="text-sm font-semibold text-[var(--pb-text)]">{{ t('admin.editor.wordCard.selectSenses') }}</h4>
                    <div class="flex gap-1">
                      <UButton type="button" size="xs" color="neutral" variant="ghost" @click="selectAllSenses">
                        {{ t('admin.editor.wordCard.selectAll') }}
                      </UButton>
                      <UButton type="button" size="xs" color="neutral" variant="ghost" @click="selectedSenseIds = []">
                        {{ t('admin.editor.wordCard.selectNone') }}
                      </UButton>
                    </div>
                  </div>

                  <ul class="divide-y divide-[var(--pb-divider)] rounded-[var(--pb-radius-md)] border border-[var(--pb-divider)]">
                    <li v-for="sense in selectedWord.senses" :key="sense.id" class="flex items-start gap-2.5 p-2.5">
                      <UCheckbox
                        :model-value="selectedSenseIds.includes(sense.id)"
                        :aria-label="sense.definition"
                        class="mt-0.5"
                        @update:model-value="toggleSense(sense.id, $event === true)"
                      />
                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-baseline gap-2">
                          <span class="text-[0.68rem] font-bold uppercase tracking-wider text-[var(--pb-primary)]">{{ sense.partOfSpeech }}</span>
                          <span v-if="readSenseTranslation(sense, targetLanguage)" class="text-xs text-[var(--pb-text-subtle)]">{{ readSenseTranslation(sense, targetLanguage) }}</span>
                        </div>
                        <p class="mt-0.5 text-sm text-[var(--pb-text)]">{{ sense.definition }}</p>
                      </div>
                    </li>
                  </ul>
                </div>

                <div class="mt-4 space-y-1.5">
                  <label class="text-sm font-semibold text-[var(--pb-text)]" for="word-card-picker-target">{{ t('admin.editor.wordCard.targetLanguage') }}</label>
                  <USelect
                    id="word-card-picker-target"
                    :model-value="targetLanguage"
                    :items="targetItems"
                    class="w-full"
                    @update:model-value="targetLanguage = String($event ?? '')"
                  />
                  <p class="text-xs text-[var(--pb-text-subtle)]">{{ t('admin.editor.wordCard.targetLanguageHint') }}</p>
                </div>
              </template>

              <div v-else class="grid h-full min-h-40 place-items-center p-6 text-center text-sm text-[var(--pb-text-subtle)]">
                {{ t('admin.editor.wordCard.chooseWordHint') }}
              </div>
            </div>
          </div>

          <footer class="flex items-center justify-between gap-2 border-t border-[var(--pb-divider)] px-4 py-3">
            <span class="text-xs text-[var(--pb-text-subtle)]">
              {{ selectedWord ? t('admin.editor.wordCard.selectedCount', { selected: selectedSenseIds.length, total: selectedWord.senses.length }) : '' }}
            </span>
            <div class="flex gap-2">
              <UButton type="button" variant="ghost" color="neutral" @click="close">{{ t('admin.common.cancel') }}</UButton>
              <UButton type="button" :disabled="!canConfirm" @click="confirm">{{ t('admin.editor.wordCard.insert') }}</UButton>
            </div>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import type { WordRecord } from '~/types/word'
import {
  DEFAULT_TARGET_LANGUAGE,
  hasSenseTranslations,
  normalizeSenseIds,
  normalizeTargetLanguage,
  senseTranslation as readSenseTranslation,
  WORD_TARGET_LANGUAGES
} from '~/utils/words'

const props = withDefaults(defineProps<{
  open: boolean
  initialWordId?: string
  initialSenseIds?: string[]
  initialTargetLanguage?: string
}>(), {
  initialWordId: '',
  initialSenseIds: () => [],
  initialTargetLanguage: ''
})

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'confirm', value: { word: WordRecord, senseIds: string[], targetLanguage: string }): void
}>()

const { t } = useI18n()
const query = ref('')
const loading = ref(false)
const loadError = ref(false)
const words = ref<WordRecord[]>([])
const selectedId = ref('')
const selectedSenseIds = ref<string[]>([])
const targetLanguage = ref('')
let loadToken = 0

const filteredWords = computed(() => {
  const needle = query.value.trim().toLowerCase()
  const sorted = [...words.value].sort((left, right) => left.headword.localeCompare(right.headword))
  if (!needle) return sorted
  return sorted.filter(word => [
    word.headword,
    word.pronunciation ?? '',
    ...word.senses.flatMap(sense => [sense.partOfSpeech, sense.definition])
  ].join(' ').toLowerCase().includes(needle))
})

const selectedWord = computed(() => words.value.find(word => word.id === selectedId.value) ?? null)
const targetItems = computed(() => [
  { label: t('admin.editor.wordCard.noTranslation'), value: '' },
  ...WORD_TARGET_LANGUAGES.map(item => ({ label: item.label, value: item.value }))
])
const canConfirm = computed(() => Boolean(selectedWord.value && !selectedWord.value.archived && selectedSenseIds.value.length))

watch(() => props.open, (open) => {
  if (open) {
    void initialize()
  } else {
    query.value = ''
  }
}, { immediate: true })

async function initialize() {
  const token = ++loadToken
  loading.value = true
  loadError.value = false
  selectedId.value = ''
  selectedSenseIds.value = []
  targetLanguage.value = ''
  words.value = []

  try {
    const response = await $fetch<{ words: WordRecord[] }>('/api/admin/words', {
      params: { status: 'active', limit: 500 }
    })
    if (token !== loadToken) return
    words.value = response.words ?? []

    if (props.initialWordId && !words.value.some(word => word.id === props.initialWordId)) {
      const lookup = await $fetch<{ words: WordRecord[] }>('/api/admin/words/lookup', {
        params: { ids: props.initialWordId }
      })
      const missingWord = lookup.words?.[0]
      if (missingWord) words.value = [missingWord, ...words.value]
    }

    const initial = words.value.find(word => word.id === props.initialWordId)
    if (initial) {
      applyWord(initial, props.initialSenseIds, props.initialTargetLanguage)
    }
  } catch {
    if (token === loadToken) {
      words.value = []
      loadError.value = true
    }
  } finally {
    if (token === loadToken) loading.value = false
  }
}

function selectWord(word: WordRecord) {
  if (word.id === selectedId.value) return
  applyWord(word)
}

function applyWord(word: WordRecord, senseIds: string[] = [], target = '') {
  selectedId.value = word.id
  const valid = normalizeSenseIds(senseIds).filter(id => word.senses.some(sense => sense.id === id))
  selectedSenseIds.value = valid.length ? valid : word.senses.map(sense => sense.id)
  const requestedTarget = normalizeTargetLanguage(target)
  if (requestedTarget && hasSenseTranslations(word, requestedTarget)) {
    targetLanguage.value = requestedTarget
  } else {
    targetLanguage.value = hasSenseTranslations(word, DEFAULT_TARGET_LANGUAGE) ? DEFAULT_TARGET_LANGUAGE : ''
  }
}

function toggleSense(id: string, checked: boolean) {
  selectedSenseIds.value = checked
    ? normalizeSenseIds([...selectedSenseIds.value, id])
    : selectedSenseIds.value.filter(senseId => senseId !== id)
}

function selectAllSenses() {
  selectedSenseIds.value = selectedWord.value?.senses.map(sense => sense.id) ?? []
}

function confirm() {
  const word = selectedWord.value
  if (!word || !selectedSenseIds.value.length) return

  emit('confirm', {
    word,
    senseIds: [...selectedSenseIds.value],
    targetLanguage: targetLanguage.value
  })
}

function close() {
  emit('update:open', false)
}

function languageName(value: string): string {
  return value === 'en' ? 'English' : value
}

</script>

<style scoped>
.word-card-picker-enter-active,
.word-card-picker-leave-active {
  transition: opacity 140ms ease;
}

.word-card-picker-enter-from,
.word-card-picker-leave-to {
  opacity: 0;
}
</style>
