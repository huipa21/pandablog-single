<template>
  <div class="post-embed-block" data-type="post-embed" :data-block-width="blockWidth" :style="blockStyle">
    <article v-if="target" class="group relative grid min-w-0 overflow-hidden rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] border-l-[3px] border-l-[var(--pb-primary)] bg-[var(--pb-card-bg)] shadow-[var(--pb-shadow-sm)] transition duration-200 hover:-translate-y-0.5 hover:border-[var(--pb-selected-border)] hover:shadow-[var(--pb-shadow-md)]">
      <NuxtLink
        :to="`/blog/${target.slug}`"
        class="absolute inset-0 z-10 rounded-[var(--pb-radius-card-outer)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pb-selected-border)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pb-card-bg)]"
        :aria-label="t('public.postEmbed.openPost', { title: displayTitle })"
      />
      <div v-if="showCover" class="post-embed-media relative z-0 block overflow-hidden bg-[var(--pb-surface-subtle)]">
        <img
          v-if="coverSrc"
          :src="coverSrc"
          :alt="displayTitle"
          class="absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
          loading="lazy"
          decoding="async"
          @error="onCoverError"
        >
        <div v-else class="grid h-full w-full place-items-center bg-[linear-gradient(135deg,var(--pb-surface-subtle),var(--pb-selected-bg))]">
          <UIcon name="i-lucide-newspaper" class="size-10 text-[var(--pb-icon-muted)]" />
        </div>
      </div>
      <div class="flex min-w-0 flex-1 flex-col justify-center p-3 sm:p-5 md:p-6">
        <h2 class="flex items-center gap-2 font-[var(--pb-font-display)] text-lg font-semibold leading-tight text-[var(--pb-text)] transition group-hover:text-[var(--pb-link-hover)] sm:text-2xl">
          <UIcon name="i-lucide-file-text" class="size-5 shrink-0 text-[var(--pb-primary)]" />
          <span class="min-w-0 truncate">{{ displayTitle }}</span>
        </h2>
        <div class="mt-2 flex items-center gap-1.5 text-xs text-[var(--pb-text-subtle)]">
          <UIcon name="i-lucide-external-link" class="size-3.5 text-[var(--pb-icon-muted)]" />
          <span class="truncate">/blog/{{ target.slug }}</span>
        </div>
      </div>
    </article>

    <div v-else-if="postId" class="post-embed-unavailable" data-testid="post-embed-unavailable">
      <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0 text-[var(--pb-icon-muted)]" />
      <span class="truncate text-sm text-[var(--pb-text-muted)]">
        {{ fallbackTitle ? t('public.postEmbed.unavailableWithTitle', { title: fallbackTitle }) : t('public.postEmbed.unavailable') }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
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
const { resolveMediaUrl, toPublicMediaVariantUrl } = useMediaUrl()

const postId = computed(() => String(props.node.attrs?.postId ?? '').trim())
const fallbackTitle = computed(() => String(props.node.attrs?.title ?? '').trim())
const customLabel = computed(() => String(props.node.attrs?.customLabel ?? '').trim())
const blockWidth = computed(() => normalizeBlockWidth(String(props.node.attrs?.blockWidth ?? 'content')))
const showCover = computed(() => props.node.attrs?.showCover !== false)

const injected = computed<ResolvedTarget | null>(() => {
  const value = props.node.attrs?.resolved
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ResolvedTarget : null
})

const fetched = ref<ResolvedTarget | null>(null)

// SSR pages inject `resolved` server-side; when absent (e.g. editor preview
// rendering a local draft) resolve it client-side from the public endpoint.
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
const coverSrc = computed(() => toPublicMediaVariantUrl(target.value?.cover_image ?? '', 'medium'))

function onCoverError(event: Event) {
  const img = event.target as HTMLImageElement | null
  if (!img || img.dataset.coverFallback === 'true') return
  const original = resolveMediaUrl(target.value?.cover_image ?? '')
  if (!original || original === img.src) return
  img.dataset.coverFallback = 'true'
  img.src = original
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
.post-embed-block {
  display: block;
  margin: 1rem 0;
}

.post-embed-media {
  width: 8.5rem;
  min-height: 6.5rem;
}

@media (max-width: 640px) {
  .post-embed-media {
    width: 6rem;
  }
}

.post-embed-unavailable {
  display: flex;
  gap: 0.65rem;
  align-items: center;
  padding: 0.9rem 1rem;
  background: var(--pb-card-bg);
  border: 1px dashed var(--pb-divider);
  border-radius: var(--pb-radius-card-outer);
}
</style>
