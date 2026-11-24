<template>
  <article class="pb-word-card" :class="{ 'pb-word-card--compact': compact, 'pb-word-card--archived': word.archived }">
    <header class="pb-word-card__header">
      <div class="min-w-0">
        <p class="pb-word-card__eyebrow">
          <span>{{ languageLabel }}</span>
          <template v-if="translationLanguage">
            <UIcon name="i-lucide-arrow-right" class="size-3.5" aria-hidden="true" />
            <span>{{ translationLanguageLabel }}</span>
          </template>
        </p>
        <h3 class="pb-word-card__headword" :lang="word.language">{{ word.headword }}</h3>
        <p v-if="word.pronunciation" class="pb-word-card__pronunciation">{{ word.pronunciation }}</p>
      </div>
      <span v-if="word.archived" class="pb-word-card__badge">
        <UIcon name="i-lucide-archive" class="size-3.5" aria-hidden="true" />
        {{ t('public.wordCard.archived') }}
      </span>
      <UIcon v-else name="i-lucide-book-marked" class="pb-word-card__mark" aria-hidden="true" />
    </header>

    <div v-if="groups.length" class="pb-word-card__senses">
      <section v-for="group in groups" :key="group.partOfSpeech" class="pb-word-card__group">
        <h4 class="pb-word-card__pos">{{ group.partOfSpeech }}</h4>
        <ol class="pb-word-card__list">
          <li v-for="(sense, index) in group.senses" :key="sense.id" class="pb-word-card__sense">
            <span class="pb-word-card__number" aria-hidden="true">{{ index + 1 }}</span>
            <div class="min-w-0">
              <p class="pb-word-card__definition">{{ sense.definition }}</p>
              <p v-if="translationFor(sense)" class="pb-word-card__translation" :lang="translationLanguage">
                {{ translationFor(sense) }}
              </p>
              <p v-if="sense.example" class="pb-word-card__example">{{ sense.example }}</p>
              <p v-if="sense.note" class="pb-word-card__note">
                <UIcon name="i-lucide-lightbulb" class="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                <span>{{ sense.note }}</span>
              </p>
            </div>
          </li>
        </ol>
      </section>
    </div>

    <p v-else class="pb-word-card__empty">
      {{ t('public.wordCard.noSelectedSenses') }}
    </p>
  </article>
</template>

<script setup lang="ts">
import type { WordRecord, WordSense } from '~/types/word'
import {
  groupSensesByPartOfSpeech,
  normalizeTargetLanguage,
  senseTranslation,
  selectWordSenses,
  WORD_LANGUAGES,
  WORD_TARGET_LANGUAGES
} from '~/utils/words'

const props = defineProps<{
  word: WordRecord
  senseIds?: unknown
  targetLanguage?: unknown
  compact?: boolean
}>()

const { t } = useI18n()

const translationLanguage = computed(() => normalizeTargetLanguage(props.targetLanguage))
const selectedSenses = computed(() => selectWordSenses(props.word, props.senseIds))
const groups = computed(() => groupSensesByPartOfSpeech(selectedSenses.value))
const languageLabel = computed(() => languageName(props.word.language))
const translationLanguageLabel = computed(() => languageName(translationLanguage.value))

function translationFor(sense: WordSense): string {
  return senseTranslation(sense, translationLanguage.value)
}

function languageName(value: string): string {
  const target = value === 'en'
    ? WORD_LANGUAGES.find(item => item.value === value)
    : WORD_TARGET_LANGUAGES.find(item => item.value === value)
  return target?.label ?? value.toUpperCase()
}
</script>

<style scoped>
.pb-word-card {
  min-width: 0;
  padding: clamp(1.15rem, 2.5vw, 1.6rem);
  overflow: hidden;
  color: var(--pb-text);
  background: var(--pb-card-bg);
  border: 1px solid var(--pb-card-border);
  border-left: 3px solid var(--pb-primary);
  border-radius: var(--pb-radius-card-outer);
  box-shadow: var(--pb-shadow-sm);
}

.pb-word-card--compact {
  padding: 1rem;
}

.pb-word-card--archived {
  border-left-color: var(--pb-text-subtle);
}

.pb-word-card__header {
  display: flex;
  gap: 1rem;
  align-items: flex-start;
  justify-content: space-between;
}

.pb-word-card__eyebrow {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  align-items: center;
  margin: 0 0 0.35rem;
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--pb-text-subtle);
}

.pb-word-card__headword {
  margin: 0;
  overflow-wrap: anywhere;
  font-family: var(--pb-font-display);
  font-size: clamp(1.75rem, 4.5vw, 2.5rem);
  font-weight: 600;
  line-height: 1.08;
  color: var(--pb-text);
}

.pb-word-card__pronunciation {
  margin: 0.4rem 0 0;
  font-size: 0.95rem;
  color: var(--pb-text-muted);
}

.pb-word-card__mark {
  flex: none;
  margin-top: 0.2rem;
  color: var(--pb-primary);
}

.pb-word-card__badge {
  display: inline-flex;
  flex: none;
  gap: 0.3rem;
  align-items: center;
  padding: 0.2rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--pb-text-muted);
  background: var(--pb-surface-subtle);
  border: 1px solid var(--pb-divider);
  border-radius: var(--pb-radius-sm);
}

.pb-word-card__senses {
  display: grid;
  gap: 1.15rem;
  margin-top: 1.25rem;
}

.pb-word-card__group {
  display: grid;
  gap: 0.5rem;
}

.pb-word-card__pos {
  margin: 0;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--pb-primary);
}

.pb-word-card__list {
  display: grid;
  gap: 0.75rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.pb-word-card__sense {
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr);
  gap: 0.55rem;
  align-items: start;
}

.pb-word-card__number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.5rem;
  margin-top: 0.05rem;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--pb-primary);
  background: var(--pb-selected-bg);
  border-radius: var(--pb-radius-sm);
}

.pb-word-card__definition {
  margin: 0;
  font-size: 0.95rem;
  line-height: 1.55;
  color: var(--pb-text);
  white-space: pre-line;
}

.pb-word-card__translation {
  margin: 0.2rem 0 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--pb-text-muted);
}

.pb-word-card__example {
  margin: 0.35rem 0 0;
  font-size: 0.875rem;
  font-style: italic;
  line-height: 1.5;
  color: var(--pb-text-muted);
  white-space: pre-line;
}

.pb-word-card__note {
  display: flex;
  gap: 0.35rem;
  align-items: flex-start;
  margin: 0.45rem 0 0;
  padding: 0.4rem 0.55rem;
  font-size: 0.8rem;
  line-height: 1.45;
  color: var(--pb-text-muted);
  white-space: pre-line;
  background: var(--pb-surface-subtle);
  border-radius: var(--pb-radius-sm);
}

.pb-word-card__empty {
  margin: 1rem 0 0;
  font-size: 0.875rem;
  color: var(--pb-text-subtle);
}
</style>
