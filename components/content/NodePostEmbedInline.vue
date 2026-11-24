<template>
  <NuxtLink
    v-if="target"
    :to="`/blog/${target.slug}`"
    class="post-embed-inline"
    :aria-label="t('public.postEmbed.openPost', { title: displayTitle })"
  >
    <UIcon name="i-lucide-file-text" class="size-3.5 shrink-0" />
    <span class="truncate">{{ displayTitle }}</span>
  </NuxtLink>

  <span v-else-if="postId" class="post-embed-inline post-embed-inline-unavailable" :title="t('public.postEmbed.unavailable')">
    <UIcon name="i-lucide-circle-alert" class="size-3.5 shrink-0" />
    <span class="truncate">{{ fallbackTitle }}</span>
  </span>
</template>

<script setup lang="ts">
import type { JsonContent } from '~/types/content'

interface ResolvedTarget {
  id: string
  slug: string
  title: string
  cover_image: string | null
}

const props = defineProps<{
  node: JsonContent
}>()

const { t } = useI18n()

const postId = computed(() => String(props.node.attrs?.postId ?? '').trim())
const fallbackTitle = computed(() => String(props.node.attrs?.title ?? '').trim())
const customLabel = computed(() => String(props.node.attrs?.customLabel ?? '').trim())

const injected = computed<ResolvedTarget | null>(() => {
  const value = props.node.attrs?.resolved
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ResolvedTarget : null
})

const fetched = ref<ResolvedTarget | null>(null)

const target = computed<ResolvedTarget | null>(() => injected.value ?? fetched.value)

watch(postId, (id) => {
  fetched.value = null
  if (id && !injected.value) void resolveClient(id)
}, { immediate: true })

async function resolveClient(id: string) {
  try {
    const response = await $fetch<{ items: ResolvedTarget[] }>('/api/posts/resolve', { params: { ids: id } })
    fetched.value = response.items?.[0] ?? null
  } catch {
    fetched.value = null
  }
}

const displayTitle = computed(() => customLabel.value || target.value?.title || fallbackTitle.value)
</script>

<style scoped>
.post-embed-inline {
  display: inline-flex;
  gap: 0.3rem;
  align-items: center;
  max-width: 16rem;
  padding: 0.1rem 0.45rem;
  font-size: 0.85em;
  font-weight: 600;
  vertical-align: baseline;
  color: var(--pb-link);
  background: var(--pb-selected-bg);
  border: 1px solid var(--pb-divider);
  border-radius: var(--pb-radius-sm);
  text-decoration: none;
  transition: background 140ms ease, border-color 140ms ease;
}

.post-embed-inline:hover,
.post-embed-inline:focus-visible {
  background: var(--pb-surface-subtle);
  border-color: var(--pb-selected-border);
}

.post-embed-inline-unavailable {
  color: var(--pb-text-subtle);
  text-decoration: line-through;
  cursor: default;
}
</style>
