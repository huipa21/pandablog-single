<template>
  <form class="grid gap-5" @submit.prevent="submit">
    <div class="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)]">
      <UFormField :label="t('admin.words.headword')" required>
        <UInput v-model="headword" :placeholder="t('admin.words.headwordPlaceholder')" autofocus class="w-full" />
      </UFormField>
      <UFormField :label="t('admin.words.sourceLanguage')">
        <USelect v-model="language" :items="languageItems" class="w-full" />
      </UFormField>
    </div>

    <UFormField :label="t('admin.words.pronunciation')">
      <UInput v-model="pronunciation" :placeholder="t('admin.words.pronunciationPlaceholder')" class="w-full" />
    </UFormField>

    <div class="grid gap-1">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="text-sm font-semibold text-[var(--pb-text)]">{{ t('admin.words.sensesTitle') }}</h3>
        <UButton type="button" size="xs" variant="soft" icon="i-lucide-plus" @click="addSense">
          {{ t('admin.words.addSense') }}
        </UButton>
      </div>
      <p class="text-xs text-[var(--pb-text-subtle)]">{{ t('admin.words.sensesHint') }}</p>
    </div>

    <div class="grid gap-3">
      <article
        v-for="(sense, index) in senses"
        :key="sense.key"
        class="grid gap-3 rounded-[var(--pb-radius-md)] border border-[var(--pb-divider)] bg-[var(--pb-surface-subtle)] p-3"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-xs font-semibold uppercase tracking-wider text-[var(--pb-text-subtle)]">
            {{ t('admin.words.sensesTitle') }} {{ index + 1 }}
          </span>
          <div class="flex gap-1">
            <UButton type="button" size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-up" :disabled="index === 0" :aria-label="t('admin.words.moveUp')" @click="moveSense(index, -1)" />
            <UButton type="button" size="xs" color="neutral" variant="ghost" icon="i-lucide-arrow-down" :disabled="index === senses.length - 1" :aria-label="t('admin.words.moveDown')" @click="moveSense(index, 1)" />
            <UButton type="button" size="xs" color="error" variant="ghost" icon="i-lucide-trash-2" :disabled="senses.length <= 1" :aria-label="t('admin.words.removeSense')" @click="removeSense(index)" />
          </div>
        </div>

        <div class="grid gap-3 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
          <UFormField :label="t('admin.words.partOfSpeech')" required>
            <UInput v-model="sense.partOfSpeech" :placeholder="t('admin.words.partOfSpeech')" class="w-full" />
          </UFormField>
          <UFormField :label="t('admin.words.translation')">
            <UInput v-model="sense.translation" :placeholder="t('admin.words.translationPlaceholder')" class="w-full" />
          </UFormField>
        </div>

        <UFormField :label="t('admin.words.definition')" required>
          <UTextarea v-model="sense.definition" :rows="3" :placeholder="t('admin.words.definitionPlaceholder')" class="w-full" />
        </UFormField>

        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField :label="t('admin.words.example')">
            <UTextarea v-model="sense.example" :rows="2" :placeholder="t('admin.words.examplePlaceholder')" class="w-full" />
          </UFormField>
          <UFormField :label="t('admin.words.note')">
            <UTextarea v-model="sense.note" :rows="2" :placeholder="t('admin.words.notePlaceholder')" class="w-full" />
          </UFormField>
        </div>
      </article>
    </div>

    <p v-if="error" class="text-sm text-[var(--pb-danger)]" role="alert">{{ error }}</p>

    <div class="flex justify-end gap-2 border-t border-[var(--pb-divider)] pt-4">
      <UButton type="button" color="neutral" variant="ghost" :disabled="saving" @click="$emit('cancel')">
        {{ t('admin.common.cancel') }}
      </UButton>
      <UButton type="submit" :loading="saving" icon="i-lucide-check">
        {{ t('admin.words.saveWord') }}
      </UButton>
    </div>
  </form>
</template>

<script setup lang="ts">
import type { WordInput, WordInputSense, WordRecord } from '~/types/word'
import { DEFAULT_PART_OF_SPEECH, normalizeWordSense, WORD_LANGUAGES } from '~/utils/words'

interface EditableSense {
  key: string
  id: string
  partOfSpeech: string
  definition: string
  example: string
  note: string
  translation: string
}

const props = defineProps<{
  word?: WordRecord | null
  saving?: boolean
}>()

const emit = defineEmits<{
  (e: 'submit', value: WordInput): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()
const languageItems = WORD_LANGUAGES.map(item => ({ label: item.label, value: String(item.value) }))
const headword = ref('')
const language = ref('en')
const pronunciation = ref('')
const senses = ref<EditableSense[]>([])
const error = ref('')
let senseKey = 0

reset()

function reset() {
  headword.value = props.word?.headword ?? ''
  language.value = props.word?.language ?? 'en'
  pronunciation.value = props.word?.pronunciation ?? ''
  senses.value = props.word?.senses.length
    ? props.word.senses.map(toEditable)
    : [makeSense()]
  error.value = ''
}

function toEditable(sense: WordRecord['senses'][number]): EditableSense {
  return {
    key: sense.id || `sense-${senseKey++}`,
    id: sense.id,
    partOfSpeech: sense.partOfSpeech || DEFAULT_PART_OF_SPEECH,
    definition: sense.definition,
    example: sense.example ?? '',
    note: sense.note ?? '',
    translation: sense.translations?.['zh-CN'] ?? ''
  }
}

function makeSense(): EditableSense {
  return {
    key: `sense-${senseKey++}`,
    id: '',
    partOfSpeech: DEFAULT_PART_OF_SPEECH,
    definition: '',
    example: '',
    note: '',
    translation: ''
  }
}

function addSense() {
  senses.value.push(makeSense())
}

function removeSense(index: number) {
  if (senses.value.length <= 1) return
  senses.value.splice(index, 1)
}

function moveSense(index: number, direction: number) {
  const destination = index + direction
  if (destination < 0 || destination >= senses.value.length) return
  const [sense] = senses.value.splice(index, 1)
  if (sense) senses.value.splice(destination, 0, sense)
}

function submit() {
  error.value = ''
  if (!headword.value.trim()) {
    error.value = t('admin.words.headwordRequired')
    return
  }

  const normalized = senses.value
    .map(sense => normalizeWordSense({
      id: sense.id,
      partOfSpeech: sense.partOfSpeech,
      definition: sense.definition,
      example: sense.example,
      note: sense.note,
      translations: sense.translation.trim() ? { 'zh-CN': sense.translation } : {}
    }))
    .filter((sense): sense is NonNullable<typeof sense> => Boolean(sense))

  if (!normalized.length) {
    error.value = t('admin.words.definitionRequired')
    return
  }

  emit('submit', {
    headword: headword.value.trim(),
    language: language.value,
    pronunciation: pronunciation.value.trim(),
    senses: normalized.map((sense): WordInputSense => ({
      id: sense.id,
      partOfSpeech: sense.partOfSpeech,
      definition: sense.definition,
      example: sense.example ?? '',
      note: sense.note ?? '',
      translations: sense.translations
    })),
    archived: props.word?.archived === true
  })
}
</script>
