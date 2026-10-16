<template>
  <form
    class="search-advanced-panel grid gap-4 rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] p-4 text-left text-[var(--pb-text)] shadow-[var(--pb-shadow-lg)]"
    data-testid="search-advanced-panel"
    @submit.prevent="submit"
  >
    <!-- Keyword groups -->
    <section class="grid gap-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="search-advanced-label">{{ t('public.search.advanced.keywords') }}</span>
        <div v-if="rows.length > 1" class="search-advanced-segment" role="radiogroup" :aria-label="t('public.search.advanced.groupsOperator')">
          <button
            v-for="option in groupOperatorOptions"
            :key="option.value"
            type="button"
            role="radio"
            :aria-checked="groupOp === option.value"
            :class="{ 'is-active': groupOp === option.value }"
            @click="groupOp = option.value"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <template v-for="(row, index) in rows" :key="row.id">
        <div v-if="index > 0" class="search-advanced-joiner">
          {{ groupOp === 'or' ? t('public.search.advanced.or') : t('public.search.advanced.and') }}
        </div>
        <div class="flex items-center gap-2">
          <UInput
            v-model="row.text"
            class="min-w-0 flex-1"
            :ui="{ root: 'w-full' }"
            :placeholder="t('public.search.advanced.keywordPlaceholder')"
            :aria-label="t('public.search.advanced.keywordGroup', { index: index + 1 })"
            data-testid="search-advanced-keywords"
            autocomplete="off"
          />
          <div class="search-advanced-segment" role="radiogroup" :aria-label="t('public.search.advanced.groupOperator')">
            <button
              type="button"
              role="radio"
              :aria-checked="row.op === 'or'"
              :class="{ 'is-active': row.op === 'or' }"
              :title="t('public.search.advanced.matchAnyHint')"
              @click="row.op = 'or'"
            >
              {{ t('public.search.advanced.matchAny') }}
            </button>
            <button
              type="button"
              role="radio"
              :aria-checked="row.op === 'and'"
              :class="{ 'is-active': row.op === 'and' }"
              :title="t('public.search.advanced.matchAllHint')"
              @click="row.op = 'and'"
            >
              {{ t('public.search.advanced.matchAll') }}
            </button>
          </div>
          <UButton
            v-if="rows.length > 1"
            type="button"
            variant="ghost"
            color="neutral"
            size="sm"
            icon="i-lucide-x"
            :aria-label="t('public.search.advanced.removeGroup')"
            @click="removeRow(index)"
          />
        </div>
      </template>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs text-[var(--pb-text-subtle)]">{{ t('public.search.advanced.keywordsHint') }}</p>
        <UButton
          v-if="rows.length < SEARCH_LIMITS.maxGroups"
          type="button"
          variant="ghost"
          color="neutral"
          size="xs"
          icon="i-lucide-plus"
          @click="addRow"
        >
          {{ t('public.search.advanced.addGroup') }}
        </UButton>
      </div>
    </section>

    <div class="h-px bg-[var(--pb-divider)]" />

    <!-- Filters -->
    <section class="grid gap-3 sm:grid-cols-2">
      <label class="grid gap-1.5 sm:col-span-2">
        <span class="search-advanced-label">{{ t('public.search.advanced.categories') }}</span>
        <UInputMenu
          v-model="categories"
          :items="categoryItems"
          value-key="value"
          multiple
          open-on-click
          :loading="optionsPending"
          :placeholder="categories.length ? '' : t('public.search.advanced.categoriesPlaceholder')"
          class="w-full"
          data-testid="search-advanced-categories"
        />
        <span class="text-xs text-[var(--pb-text-subtle)]">{{ t('public.search.advanced.includesSubcategories') }}</span>
      </label>

      <label class="grid gap-1.5">
        <span class="search-advanced-label">{{ t('public.search.advanced.tags') }}</span>
        <UInputMenu
          v-model="tags"
          :items="tagItems"
          value-key="value"
          multiple
          open-on-click
          :loading="optionsPending"
          :placeholder="tags.length ? '' : t('public.search.advanced.tagsPlaceholder')"
          class="w-full"
          data-testid="search-advanced-tags"
        />
      </label>

      <label class="grid gap-1.5 sm:col-span-2">
        <span class="search-advanced-label">{{ t('public.search.advanced.date') }}</span>
        <USelect
          v-model="datePreset"
          :items="dateItems"
          value-key="value"
          class="w-full"
          data-testid="search-advanced-date"
        />
      </label>

      <div v-if="datePreset === 'custom'" class="grid gap-3 sm:col-span-2 sm:grid-cols-2">
        <label class="grid gap-1.5">
          <span class="text-xs text-[var(--pb-text-subtle)]">{{ t('public.search.advanced.dateFrom') }}</span>
          <UInput v-model="start" type="date" :max="end || undefined" class="w-full" data-testid="search-advanced-start" />
        </label>
        <label class="grid gap-1.5">
          <span class="text-xs text-[var(--pb-text-subtle)]">{{ t('public.search.advanced.dateTo') }}</span>
          <UInput v-model="end" type="date" :min="start || undefined" class="w-full" data-testid="search-advanced-end" />
        </label>
      </div>
    </section>

    <div class="flex items-center justify-between gap-2 border-t border-[var(--pb-divider)] pt-3">
      <UButton type="button" variant="ghost" color="neutral" size="sm" icon="i-lucide-rotate-ccw" @click="reset">
        {{ t('public.search.advanced.reset') }}
      </UButton>
      <UButton type="submit" color="primary" size="sm" icon="i-lucide-search" data-testid="search-advanced-submit">
        {{ t('public.search.advanced.apply') }}
      </UButton>
    </div>
  </form>
</template>

<script setup lang="ts">
import {
  SEARCH_LIMITS,
  createEmptySearchCriteria,
  splitSearchTerms,
  type AdvancedSearchCriteria,
  type SearchDatePreset,
  type SearchKeywordOperator
} from '~/utils/searchQuery'

interface KeywordRow {
  id: number
  op: SearchKeywordOperator
  text: string
}

const props = defineProps<{
  /** Current criteria; the panel edits everything except the plain `q`. */
  criteria: AdvancedSearchCriteria
}>()

const emit = defineEmits<{
  submit: [criteria: AdvancedSearchCriteria]
}>()

const { t } = useI18n()
const { options, pending: optionsPending, load: loadOptions } = useSearchOptions()

let rowSeed = 0
const rows = ref<KeywordRow[]>([])
const groupOp = ref<SearchKeywordOperator>('and')
const categories = ref<string[]>([])
const tags = ref<string[]>([])
const datePreset = ref<SearchDatePreset | 'any'>('any')
const start = ref('')
const end = ref('')

function newRow(op: SearchKeywordOperator = 'or', text = ''): KeywordRow {
  rowSeed += 1
  return { id: rowSeed, op, text }
}

function syncFromCriteria(criteria: AdvancedSearchCriteria) {
  rows.value = criteria.groups.length
    ? criteria.groups.map((group) => newRow(group.op, group.terms.join(', ')))
    : [newRow()]
  groupOp.value = criteria.groupOp
  categories.value = [...criteria.categories]
  tags.value = [...criteria.tags]
  datePreset.value = criteria.date || 'any'
  start.value = criteria.start
  end.value = criteria.end
}

// The popover content mounts on every open, so syncing on mount + when the
// criteria object is replaced (route change) is enough. Not deep on purpose:
// the panel must not lose edits while the user keeps typing in the bar.
watch(() => props.criteria, (criteria) => syncFromCriteria(criteria), { immediate: true })

onMounted(() => {
  void loadOptions()
})

const groupOperatorOptions = computed(() => [
  { value: 'and' as const, label: t('public.search.advanced.groupsAll') },
  { value: 'or' as const, label: t('public.search.advanced.groupsAny') }
])

/** Keep selected values selectable even before / without option data. */
function withSelected<T extends { value: string }>(items: T[], selected: string[], fallback: (value: string) => T): T[] {
  const known = new Set(items.map((item) => item.value))
  return [...items, ...selected.filter((value) => !known.has(value)).map(fallback)]
}

const categoryItems = computed(() => withSelected(
  options.value.categories.map((category) => ({ label: category.label, value: category.slug })),
  categories.value,
  (value) => ({ label: value, value })
))
const tagItems = computed(() => withSelected(
  options.value.tags.map((tag) => ({ label: tag.name, value: tag.slug })),
  tags.value,
  (value) => ({ label: value, value })
))

const dateItems = computed(() => [
  { label: t('public.search.advanced.dateAny'), value: 'any' as const },
  { label: t('public.search.advanced.date7d'), value: '7d' as const },
  { label: t('public.search.advanced.date30d'), value: '30d' as const },
  { label: t('public.search.advanced.date12m'), value: '12m' as const },
  { label: t('public.search.advanced.dateYear'), value: 'year' as const },
  { label: t('public.search.advanced.dateCustom'), value: 'custom' as const }
])

function addRow() {
  if (rows.value.length >= SEARCH_LIMITS.maxGroups) return
  rows.value.push(newRow())
}

function removeRow(index: number) {
  rows.value.splice(index, 1)
  if (!rows.value.length) rows.value.push(newRow())
}

function buildCriteria(): AdvancedSearchCriteria {
  const date = datePreset.value === 'any' ? '' : datePreset.value
  return {
    ...createEmptySearchCriteria(),
    // The plain query is owned by the search bar input.
    q: '',
    groups: rows.value
      .map((row) => ({ op: row.op, terms: splitSearchTerms(row.text) }))
      .filter((group) => group.terms.length > 0),
    groupOp: groupOp.value,
    categories: [...categories.value],
    tags: [...tags.value],
    date,
    start: date === 'custom' ? start.value : '',
    end: date === 'custom' ? end.value : '',
    tz: date ? new Date().getTimezoneOffset() : null
  }
}

function submit() {
  emit('submit', buildCriteria())
}

/** Clears the form only; nothing is applied until the user searches. */
function reset() {
  syncFromCriteria(createEmptySearchCriteria())
}
</script>

<style scoped>
.search-advanced-panel {
  width: min(34rem, calc(100vw - 1.5rem));
  max-height: min(80vh, 44rem);
  overflow-y: auto;
}

.search-advanced-label {
  color: var(--pb-text-subtle);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.search-advanced-segment {
  display: inline-flex;
  flex: 0 0 auto;
  overflow: hidden;
  border: 1px solid var(--pb-divider);
  border-radius: var(--pb-radius-sm);
}

.search-advanced-segment > button {
  padding: 0.3rem 0.6rem;
  color: var(--pb-text-muted);
  font-size: 0.75rem;
  font-weight: 500;
  transition: background var(--pb-transition-default), color var(--pb-transition-default);
}

.search-advanced-segment > button + button {
  border-left: 1px solid var(--pb-divider);
}

.search-advanced-segment > button:hover {
  color: var(--pb-text);
}

.search-advanced-segment > button.is-active {
  background: var(--pb-selected-bg);
  color: var(--pb-text);
}

.search-advanced-joiner {
  color: var(--pb-text-subtle);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  padding-left: 0.25rem;
}
</style>
