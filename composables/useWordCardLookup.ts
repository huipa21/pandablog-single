import type { MaybeRefOrGetter, Ref } from 'vue'
import { toValue } from 'vue'
import type { WordRecord } from '~/types/word'

export interface WordCardLookup {
  word: Ref<WordRecord | null>
  loading: Ref<boolean>
  /** True after a completed lookup that found no word (deleted / never existed). */
  missing: Ref<boolean>
}

/**
 * Live-resolve a word card by its `wordId` anchor through the admin lookup
 * endpoint. The snapshot headword stays on the node as a display fallback.
 */
export function useWordCardLookup(wordId: MaybeRefOrGetter<string>): WordCardLookup {
  const word = ref<WordRecord | null>(null)
  const loading = ref(false)
  const missing = ref(false)
  const anchor = computed(() => toValue(wordId))
  let requestId = 0

  watch(anchor, (next, previous) => {
    if (next === previous) return
    void resolve(next)
  }, { immediate: true })

  async function resolve(id: string) {
    if (!id) {
      word.value = null
      loading.value = false
      missing.value = false
      return
    }

    const current = ++requestId
    loading.value = true
    try {
      const response = await $fetch<{ words: WordRecord[] }>('/api/admin/words/lookup', {
        params: { ids: id }
      })
      if (current !== requestId) return
      word.value = response.words?.[0] ?? null
      missing.value = !word.value
    } catch {
      if (current !== requestId) return
      word.value = null
      missing.value = true
    } finally {
      if (current === requestId) {
        loading.value = false
      }
    }
  }

  return { word, loading, missing }
}
