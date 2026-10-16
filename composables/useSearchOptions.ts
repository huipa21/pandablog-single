import type { SearchOptionsResponse } from '~/types/content'

const EMPTY_SEARCH_OPTIONS: SearchOptionsResponse = { tags: [], categories: [] }

/**
 * Autocomplete data for the advanced search panel (tags, categories, authors).
 * Loaded lazily on the client the first time it is needed and shared across
 * every search bar instance.
 */
export function useSearchOptions() {
  const options = useState<SearchOptionsResponse | null>('public-search-options', () => null)
  const pending = useState<boolean>('public-search-options-pending', () => false)

  async function load(force = false) {
    if (import.meta.server) return
    if ((options.value && !force) || pending.value) return
    pending.value = true
    try {
      options.value = await $fetch<SearchOptionsResponse>('/api/search/options')
    } catch {
      options.value = options.value ?? EMPTY_SEARCH_OPTIONS
    } finally {
      pending.value = false
    }
  }

  const resolved = computed(() => options.value ?? EMPTY_SEARCH_OPTIONS)

  return { options: resolved, loaded: computed(() => options.value !== null), pending, load }
}
