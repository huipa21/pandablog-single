<template>
  <div class="mx-auto w-full max-w-[var(--pb-site-content-max)] space-y-6">
    <header class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="font-[var(--pb-font-display)] text-3xl font-semibold tracking-normal text-[var(--pb-text)]">{{ t('public.search.title') }}</h1>
        <UButton
          :to="backRoute"
          variant="ghost"
          color="neutral"
          icon="i-lucide-arrow-left"
          size="sm"
        >
          {{ t('public.search.back') }}
        </UButton>
      </div>
      <div class="grid gap-3 sm:flex sm:flex-wrap sm:items-center">
        <div class="min-w-0 flex-1">
          <BlogSearchBar variant="sidebar" advanced />
        </div>
        <USelectMenu
          v-model="sort"
          :items="sortOptions"
          value-key="value"
          class="w-full sm:w-44"
        />
      </div>

      <div v-if="chips.length" class="flex flex-wrap items-center gap-2" data-testid="search-active-filters">
        <span
          v-for="chip in chips"
          :key="chip.key"
          class="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[var(--pb-divider)] bg-[var(--pb-surface-subtle)] py-1 pr-1 pl-3 text-xs text-[var(--pb-text-muted)]"
        >
          <span class="font-semibold text-[var(--pb-text-subtle)]">{{ chip.label }}</span>
          <span class="truncate text-[var(--pb-text)]">{{ chip.value }}</span>
          <button
            type="button"
            class="grid size-5 shrink-0 place-items-center rounded-full text-[var(--pb-text-subtle)] transition hover:bg-[var(--pb-selected-bg)] hover:text-[var(--pb-text)]"
            :aria-label="t('public.search.removeFilter', { filter: `${chip.label} ${chip.value}` })"
            @click="removeChip(chip)"
          >
            <UIcon name="i-lucide-x" class="size-3.5" />
          </button>
        </span>
        <UButton v-if="chips.length > 1" variant="link" color="neutral" size="xs" @click="clearAll">
          {{ t('public.search.clearAll') }}
        </UButton>
      </div>

      <p v-if="data" class="text-sm text-[var(--pb-text-subtle)]">{{ resultSummary }}</p>
      <p v-else-if="!hasCriteria" class="text-sm text-[var(--pb-text-subtle)]">{{ t('public.search.prompt') }}</p>
    </header>

    <div v-if="pending" class="text-[var(--pb-text-subtle)]">{{ t('public.search.searching') }}</div>

    <ul v-else-if="data && data.results.length" class="space-y-6" data-testid="search-results">
      <li
        v-for="result in data.results"
        :key="result.post.id"
        class="rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] p-5 shadow-[var(--pb-shadow-sm)]"
      >
        <div class="flex flex-wrap items-center gap-2">
          <NuxtLink :to="`/blog/${result.post.slug}`" class="text-lg font-semibold text-[var(--pb-link)] hover:text-[var(--pb-link-hover)]">
            {{ result.post.title || result.post.slug }}
          </NuxtLink>
          <UBadge v-if="result.status === 'draft'" color="warning" variant="subtle" size="sm">{{ t('public.search.draft') }}</UBadge>
          <UIcon
            v-if="result.locked"
            name="i-lucide-lock"
            class="size-4 text-[var(--pb-text-subtle)]"
            :aria-label="t('public.search.locked')"
            :title="t('public.search.locked')"
          />
        </div>
        <p v-if="result.post.summary" class="mt-1 text-sm text-[var(--pb-text-muted)]">{{ result.post.summary }}</p>
        <div v-if="result.matches.length" class="mt-3 space-y-2">
          <div
            v-for="match in result.matches"
            :key="match.blockId"
            class="rounded-[var(--pb-radius-sm)] border border-[var(--pb-divider)] bg-[var(--pb-surface-subtle)] px-3 py-2 text-sm text-[var(--pb-text-muted)] [overflow-wrap:anywhere]"
            data-testid="search-match"
          >
            <span class="mr-2 inline-block rounded-[var(--pb-radius-sm)] bg-[var(--pb-selected-bg)] px-1.5 py-0.5 text-xs uppercase tracking-wide text-[var(--pb-link)]">
              {{ match.type }}
            </span>
            <span v-html="match.snippet" />
          </div>
        </div>
        <p v-if="result.totalMatches > result.matches.length" class="mt-2 text-xs text-[var(--pb-text-subtle)]">
          {{ moreMatchesLabel(result.totalMatches - result.matches.length) }}
        </p>
      </li>
    </ul>

    <p v-else-if="data" class="text-[var(--pb-text-subtle)]">
      {{ data.query ? t('public.search.noMatches', { query: data.query }) : t('public.search.noFilterMatches') }}
    </p>

    <div v-if="data && data.pages > 1" class="flex justify-center">
      <UPagination
        :page="data.page"
        :total="data.total"
        :items-per-page="data.limit"
        :sibling-count="1"
        size="md"
        color="neutral"
        active-color="primary"
        variant="outline"
        active-variant="solid"
        @update:page="goToPage"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import type { SearchResponse, SearchSort } from '~/types/content'
import {
  buildSearchCriteriaQuery,
  createEmptySearchCriteria,
  hasAnySearchCriteria,
  hasSearchDateRange,
  parseSearchCriteria,
  type AdvancedSearchCriteria
} from '~/utils/searchQuery'

interface CriteriaChip {
  key: string
  label: string
  value: string
  remove: (criteria: AdvancedSearchCriteria) => AdvancedSearchCriteria
}

const route = useRoute()
const { t } = useI18n()
const sessionFetch = useSessionFetch()
const { options: searchOptions, load: loadSearchOptions } = useSearchOptions()

const criteria = computed(() => parseSearchCriteria(route.query))
const hasCriteria = computed(() => hasAnySearchCriteria(criteria.value))
const sort = ref<SearchSort>(normalizeSort(route.query.sort))
const returnPath = computed(() => normalizeReturnPath(route.query.from))
const backRoute = computed(() => returnPath.value || '/')

const sortOptions = computed(() => [
  { label: t('public.search.sort.relevance'), value: 'relevance' as const },
  { label: t('public.search.sort.newest'), value: 'date_desc' as const },
  { label: t('public.search.sort.oldest'), value: 'date_asc' as const },
  { label: t('public.search.sort.title'), value: 'title' as const }
])

const apiParams = computed(() => ({
  ...buildSearchCriteriaQuery(criteria.value),
  sort: normalizeSort(route.query.sort),
  page: String(normalizePage(route.query.page))
}))

const { data, pending } = await useAsyncData<SearchResponse | null>(
  () => `search:${JSON.stringify(apiParams.value)}`,
  async () => {
    if (!hasAnySearchCriteria(criteria.value)) return null
    return await sessionFetch<SearchResponse>('/api/search', { params: apiParams.value })
  },
  { watch: [apiParams] }
)

const resultSummary = computed(() => {
  if (!data.value) return ''
  const total = data.value.total
  if (data.value.query) {
    return t(total === 1 ? 'public.search.resultSummaryOne' : 'public.search.resultSummary', { total, query: data.value.query })
  }
  return t(total === 1 ? 'public.search.filterSummaryOne' : 'public.search.filterSummary', { total })
})

// Names for category / tag chips come from the autocomplete data.
onMounted(() => {
  if (criteria.value.categories.length || criteria.value.tags.length) {
    void loadSearchOptions()
  }
})
watch(() => criteria.value.categories.length + criteria.value.tags.length, (count) => {
  if (count) void loadSearchOptions()
})

const chips = computed<CriteriaChip[]>(() => {
  const current = criteria.value
  const list: CriteriaChip[] = []
  const categoryLabels = new Map(searchOptions.value.categories.map((item) => [item.slug, item.label]))
  const tagLabels = new Map(searchOptions.value.tags.map((item) => [item.slug, item.name]))

  current.groups.forEach((group, index) => {
    list.push({
      key: `kw-${index}`,
      label: t('public.search.chips.keywords'),
      value: group.terms.join(group.op === 'and' ? ` ${t('public.search.advanced.and')} ` : ` ${t('public.search.advanced.or')} `),
      remove: (value) => ({ ...value, groups: value.groups.filter((_, groupIndex) => groupIndex !== index) })
    })
  })
  for (const slug of current.categories) {
    list.push({
      key: `cat-${slug}`,
      label: t('public.search.chips.category'),
      value: categoryLabels.get(slug) ?? slug,
      remove: (value) => ({ ...value, categories: value.categories.filter((item) => item !== slug) })
    })
  }
  for (const slug of current.tags) {
    list.push({
      key: `tag-${slug}`,
      label: t('public.search.chips.tag'),
      value: tagLabels.get(slug) ?? slug,
      remove: (value) => ({ ...value, tags: value.tags.filter((item) => item !== slug) })
    })
  }
  if (hasSearchDateRange(current)) {
    list.push({
      key: 'date',
      label: t('public.search.chips.date'),
      value: dateChipLabel(current),
      remove: (value) => ({ ...value, date: '', start: '', end: '', tz: null })
    })
  }
  return list
})

function dateChipLabel(current: AdvancedSearchCriteria) {
  switch (current.date) {
    case '7d': return t('public.search.advanced.date7d')
    case '30d': return t('public.search.advanced.date30d')
    case '12m': return t('public.search.advanced.date12m')
    case 'year': return t('public.search.advanced.dateYear')
    default: return `${current.start || '…'} – ${current.end || '…'}`
  }
}

watch(sort, (next) => {
  if (next === normalizeSort(route.query.sort)) return
  navigateWith(criteria.value, { sort: next })
})

watch(() => route.query.sort, (value) => {
  sort.value = normalizeSort(value)
})

function removeChip(chip: CriteriaChip) {
  navigateWith(chip.remove(criteria.value))
}

function clearAll() {
  navigateWith({ ...createEmptySearchCriteria(), q: criteria.value.q })
}

function goToPage(page: number) {
  navigateWith(criteria.value, { page: String(page) })
  if (import.meta.client) window.scrollTo({ top: 0, behavior: 'smooth' })
}

function navigateWith(next: AdvancedSearchCriteria, extra: Record<string, string> = {}) {
  const query: Record<string, string> = { ...buildSearchCriteriaQuery(next) }
  const currentSort = normalizeSort(route.query.sort)
  if (currentSort !== 'relevance') query.sort = currentSort
  Object.assign(query, extra)
  if (returnPath.value) query.from = returnPath.value
  navigateTo({ path: '/search', query })
}

function normalizeSort(value: unknown): SearchSort {
  if (value === 'date_desc' || value === 'date_asc' || value === 'title' || value === 'relevance') {
    return value
  }
  return 'relevance'
}

function normalizePage(value: unknown) {
  const page = Number(typeof value === 'string' ? value : 1)
  return Number.isFinite(page) && page >= 1 ? Math.min(Math.floor(page), 500) : 1
}

function normalizeReturnPath(value: unknown) {
  if (typeof value !== 'string') return ''
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/search')) return ''
  return value
}

function moreMatchesLabel(count: number) {
  return t(count === 1 ? 'public.search.moreMatchesOne' : 'public.search.moreMatches', { count })
}

useHead(() => ({ title: data.value?.query ? t('public.search.headWithQuery', { query: data.value.query }) : t('public.search.title') }))
</script>
