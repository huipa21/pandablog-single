import type { MaybeRefOrGetter, Ref } from 'vue'
import { toValue } from 'vue'

export interface PostEmbedLookupItem {
  id: string
  slug: string
  title: string
  status: 'draft' | 'published' | 'archived'
  cover_image: string | null
}

export interface PostEmbedLookup {
  post: Ref<PostEmbedLookupItem | null>
  loading: Ref<boolean>
  /** True after a completed lookup that found no post (deleted / never existed). */
  missing: Ref<boolean>
}

/**
 * Live-resolve an embedded post by its `postId` anchor via the admin lookup
 * endpoint. Snapshot title/slug stay on the node itself as display fallback
 * while loading and after the target post is gone.
 */
export function usePostEmbedLookup(postId: MaybeRefOrGetter<string>): PostEmbedLookup {
  const post = ref<PostEmbedLookupItem | null>(null)
  const loading = ref(false)
  const missing = ref(false)
  const anchor = computed(() => toValue(postId))
  let requestId = 0

  watch(anchor, (next, previous) => {
    if (next === previous) return
    void resolve(next)
  }, { immediate: true })

  async function resolve(id: string) {
    if (!id) {
      post.value = null
      loading.value = false
      missing.value = false
      return
    }

    const current = ++requestId
    loading.value = true
    try {
      const response = await $fetch<{ items: PostEmbedLookupItem[] }>('/api/admin/posts/lookup', {
        params: { ids: id }
      })
      if (current !== requestId) return
      post.value = response.items?.[0] ?? null
      missing.value = !post.value
    } catch {
      if (current !== requestId) return
      post.value = null
      missing.value = true
    } finally {
      if (current === requestId) {
        loading.value = false
      }
    }
  }

  return { post, loading, missing }
}
