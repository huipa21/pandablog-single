<template>
  <div class="word-card-block" data-type="word-card" :data-word-id="wordId" :data-block-width="blockWidth" :style="blockStyle">
    <WordCard
      v-if="word && !missingSelection"
      :word="word"
      :sense-ids="senseIds"
      :target-language="targetLanguage"
    />

    <div v-else-if="missingSelection" class="word-card-missing">
      <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0" aria-hidden="true" />
      <div class="min-w-0">
        <p class="word-card-missing__title">{{ headword || word?.headword }}</p>
        <p class="word-card-missing__text">{{ t('public.wordCard.noSelectedSenses') }}</p>
      </div>
    </div>

    <div v-else-if="loading" class="word-card-skeleton" aria-hidden="true">
      <USkeleton class="h-4 w-24" />
      <USkeleton class="mt-3 h-9 w-56" />
      <USkeleton class="mt-2 h-3 w-32" />
      <USkeleton class="mt-5 h-4 w-full" />
      <USkeleton class="mt-2 h-4 w-4/5" />
    </div>

    <div v-else class="word-card-missing">
      <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0" aria-hidden="true" />
      <div class="min-w-0">
        <p class="word-card-missing__title">{{ headword || t('public.wordCard.unavailableTitle') }}</p>
        <p class="word-card-missing__text">{{ t('public.wordCard.unavailableDescription') }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type { JsonContent } from '~/types/content'
import type { WordRecord } from '~/types/word'
import { hasSenseSelection, normalizeSenseIds, selectWordSenses } from '~/utils/words'
import WordCard from './WordCard.vue'

const props = defineProps<{
  node: JsonContent
}>()

const { t } = useI18n()

const wordId = computed(() => String(props.node.attrs?.wordId ?? '').trim())
const headword = computed(() => String(props.node.attrs?.headword ?? '').trim())
const senseIds = computed(() => normalizeSenseIds(props.node.attrs?.senseIds))
const targetLanguage = computed(() => String(props.node.attrs?.targetLanguage ?? ''))
const blockWidth = computed(() => normalizeBlockWidth(String(props.node.attrs?.blockWidth ?? 'content')))

const injected = computed<WordRecord | null>(() => {
  const value = props.node.attrs?.resolved
  return value && typeof value === 'object' && !Array.isArray(value) ? value as WordRecord : null
})

const fetched = ref<WordRecord | null>(null)
const loading = ref(false)
const word = computed<WordRecord | null>(() => injected.value ?? fetched.value)
const missingSelection = computed(() => Boolean(
  word.value && hasSenseSelection(senseIds.value) && selectWordSenses(word.value, senseIds.value).length === 0
))

// SSR pages inject `resolved` server-side; when absent (e.g. editor preview
// rendering a local draft) resolve it client-side from the public endpoint.
watch(wordId, (id) => {
  fetched.value = null
  if (import.meta.client && id && !injected.value) void resolveClient(id)
}, { immediate: true })

async function resolveClient(id: string) {
  loading.value = true
  try {
    const response = await $fetch<{ words: WordRecord[] }>('/api/words/resolve', { params: { ids: id } })
    fetched.value = response.words?.[0] ?? null
  } catch {
    fetched.value = null
  } finally {
    loading.value = false
  }
}

const blockStyle = computed<CSSProperties>(() => {
  switch (blockWidth.value) {
    case 'wide':
      return {
        width: 'min(120%, 72rem)',
        maxWidth: 'calc(100vw - 2rem)',
        position: 'relative' as const,
        left: '50%',
        transform: 'translateX(-50%)'
      }
    case 'full-bleed':
      return {
        width: '100vw',
        maxWidth: '100vw',
        position: 'relative' as const,
        left: '50%',
        transform: 'translateX(-50%)'
      }
    case 'content':
    default:
      return { width: '100%', maxWidth: '100%' }
  }
})

function normalizeBlockWidth(value: string) {
  return value === 'wide' || value === 'full-bleed' ? value : 'content'
}
</script>

<style scoped>
.word-card-block {
  display: block;
  margin: 1.25rem 0;
}

.word-card-skeleton {
  padding: 1.4rem;
  background: var(--pb-card-bg);
  border: 1px solid var(--pb-card-border);
  border-left: 3px solid var(--pb-primary);
  border-radius: var(--pb-radius-card-outer);
  box-shadow: var(--pb-shadow-sm);
}

.word-card-missing {
  display: flex;
  gap: 0.65rem;
  align-items: flex-start;
  padding: 1rem;
  color: var(--pb-text-muted);
  background: var(--pb-surface-subtle);
  border: 1px dashed var(--pb-border-strong);
  border-radius: var(--pb-radius-card-outer);
}

.word-card-missing__title {
  margin: 0;
  font-family: var(--pb-font-display);
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--pb-text);
}

.word-card-missing__text {
  margin: 0.25rem 0 0;
  font-size: 0.85rem;
}
</style>
