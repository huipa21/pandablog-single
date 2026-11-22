<template>
  <div class="min-w-0">
    <div v-if="pending" :class="layoutClasses">
      <USkeleton v-for="index in skeletonCount" :key="index" :class="skeletonClasses" />
    </div>

    <UAlert
      v-else-if="error"
      color="error"
      icon="i-lucide-circle-alert"
      :title="isSitePrivateError ? t('public.postList.sitePrivateTitle') : t('public.postList.loadFailed')"
      :description="isSitePrivateError ? t('public.postList.sitePrivateDescription') : undefined"
    />

    <div v-else-if="posts.length" :class="layoutClasses" :data-post-card-layout="isListView ? 'list' : 'grid'">
      <article
        v-for="post in posts"
        :key="post.id"
        :class="articleClasses"
      >
        <NuxtLink
          :to="`/blog/${post.slug}`"
          class="absolute inset-0 z-10 rounded-[var(--pb-radius-card-outer)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pb-selected-border)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pb-card-bg)]"
          :aria-label="t('public.postList.openPost', { title: post.title })"
        />
        <div :class="mediaClasses">
          <img
            v-if="post.cover_image"
            :src="postCoverImage(post)"
            :alt="post.title"
            :class="imageClasses"
            loading="lazy"
            decoding="async"
            @error="onCoverError(post, $event)"
          >
          <div v-else :class="placeholderClasses">
            <UIcon name="i-lucide-newspaper" class="size-10 text-[var(--pb-icon-muted)]" />
          </div>
        </div>
        <div :class="contentClasses">
          <div v-if="post.categories?.length" :class="categoryClasses">
            <NuxtLink
              v-for="category in post.categories"
              :key="category.slug"
              :to="`/category/${category.slug}`"
              class="inline-flex items-center rounded-[var(--pb-radius-sm)] bg-[var(--pb-primary)] px-3 py-1 text-xs font-semibold text-[var(--pb-primary-contrast)] shadow-[var(--pb-shadow-sm)] transition hover:bg-[var(--pb-primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--pb-selected-border)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--pb-card-bg)]"
            >
              {{ category.name }}
            </NuxtLink>
          </div>
          <h2 :class="titleClasses">
            {{ post.title }}
          </h2>
          <p v-if="postExcerpt(post)" :class="summaryClasses">{{ postExcerpt(post) }}</p>
          <div :class="metaWrapClasses">
            <div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--pb-text-subtle)]">
              <time v-if="post.published_at" :datetime="post.published_at">{{ formatDate(post.published_at) }}</time>
              <span v-if="hasViewCount(post)" class="inline-flex items-center gap-1.5">
                <UIcon name="i-lucide-eye" class="size-3.5 text-[var(--pb-icon-muted)]" />
                {{ formatViews(post.view_count) }}
              </span>
              <span v-if="contentLengthLabel(post)" class="inline-flex items-center gap-1.5">
                <UIcon name="i-lucide-file-text" class="size-3.5 text-[var(--pb-icon-muted)]" />
                {{ contentLengthLabel(post) }}
              </span>
              <span v-if="readingTimeLabel(post)" class="inline-flex items-center gap-1.5" data-testid="post-card-reading-time">
                <UIcon name="i-lucide-clock" class="size-3.5 text-[var(--pb-icon-muted)]" />
                {{ readingTimeLabel(post) }}
              </span>
              <UBadge v-if="post.visibility === 'password'" color="warning" variant="subtle" size="xs">
                {{ t('public.postList.protected') }}
              </UBadge>
            </div>
          </div>
        </div>
      </article>
    </div>

    <UEmpty v-else icon="i-lucide-file-text" :title="resolvedEmptyTitle" :description="resolvedEmptyDescription" />
  </div>
</template>

<script setup lang="ts">
import type { PostListItem } from '~/types/content'

type PostCardViewMode = 'grid' | 'list'

const { resolveMediaUrl, toPublicMediaVariantUrl } = useMediaUrl()

const props = withDefaults(defineProps<{
  posts: PostListItem[]
  pending?: boolean
  error?: unknown
  emptyTitle?: string
  emptyDescription?: string
  fixedColumns?: boolean
  gridColumns?: number
  viewMode?: PostCardViewMode
}>(), {
  pending: false,
  error: undefined,
  emptyTitle: '',
  emptyDescription: '',
  fixedColumns: false,
  gridColumns: 0,
  viewMode: 'grid'
})

const { t, locale } = useI18n()
const isListView = computed(() => props.viewMode === 'list')
const isSingleGridLayout = computed(() => !isListView.value && props.posts.length === 1)
const resolvedEmptyTitle = computed(() => props.emptyTitle || t('public.postList.emptyTitle'))
const resolvedEmptyDescription = computed(() => props.emptyDescription || t('public.postList.emptyDescription'))
const layoutClasses = computed(() => [
  'min-w-0 w-full',
  isListView.value ? 'post-card-list' : 'post-card-grid',
  !isListView.value && props.fixedColumns ? 'post-card-grid-fixed' : undefined,
  isSingleGridLayout.value ? 'post-card-grid--single' : undefined
])
const skeletonCount = computed(() => isListView.value ? 4 : 6)
const skeletonClasses = computed(() => [
  'rounded-[var(--pb-radius-card-outer)]',
  isListView.value ? 'h-40 sm:h-52' : 'aspect-square'
])
const articleClasses = computed(() => [
  'group relative min-w-0 cursor-pointer overflow-hidden rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] shadow-[var(--pb-shadow-sm)] transition duration-200 hover:-translate-y-0.5 hover:border-[var(--pb-selected-border)] hover:bg-[var(--pb-card-bg-hover)] hover:shadow-[var(--pb-shadow-md)]',
  isListView.value ? 'post-card-list-item grid' : 'post-card-grid-item grid'
])
const mediaClasses = computed(() => [
  'relative z-0 block overflow-hidden bg-[var(--pb-surface-subtle)]',
  isListView.value ? 'h-full min-h-0' : 'h-full min-h-0'
])
const imageClasses = computed(() => [
  'absolute inset-0 h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]',
  isListView.value ? 'aspect-auto' : 'aspect-auto'
])
const placeholderClasses = computed(() => [
  'grid h-full w-full place-items-center bg-[linear-gradient(135deg,var(--pb-surface-subtle),var(--pb-selected-bg))]'
])
const contentClasses = computed(() => [
  'flex min-w-0 flex-1 flex-col',
  isListView.value ? 'p-3 sm:p-5 md:p-6' : 'min-h-0 overflow-hidden p-4 sm:p-5'
])
const categoryClasses = computed(() => [
  'relative z-20 flex flex-wrap gap-2',
  isListView.value ? 'mb-2 sm:mb-4' : 'mb-3 sm:mb-4'
])
const metaWrapClasses = computed(() => [
  'mt-auto',
  isListView.value ? 'pt-3 sm:pt-5' : 'pt-4 sm:pt-5'
])
const titleClasses = computed(() => [
  'font-[var(--pb-font-display)] font-semibold leading-tight text-[var(--pb-text)] transition group-hover:text-[var(--pb-link-hover)]',
  isListView.value ? 'text-lg sm:text-2xl' : 'text-xl'
])
const summaryClasses = computed(() => [
  'mt-2 text-sm leading-relaxed text-[var(--pb-text-muted)] sm:mt-3',
  isListView.value ? 'line-clamp-3' : 'line-clamp-2'
])

const isSitePrivateError = computed(() => {
  const err = props.error as {
    statusCode?: number
    status?: number
    statusMessage?: string
    message?: string
    data?: { message?: string }
  } | null | undefined

  const statusCode = Number(err?.statusCode ?? err?.status ?? 0)
  const message = String(err?.statusMessage ?? err?.data?.message ?? err?.message ?? '').toLowerCase()
  return statusCode === 401 && message.includes('site is private')
})

function formatDate(value: string) {
  return new Intl.DateTimeFormat(locale.value, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}

function hasViewCount(post: PostListItem) {
  return post.view_count !== undefined && post.view_count !== null
}

function postCoverImage(post: PostListItem) {
  return toPublicMediaVariantUrl(post.cover_image ?? '', 'medium')
}

// If a resized variant is missing (e.g. an older upload without generated
// variants), fall back once to the full-size original so the card still shows
// an image instead of a broken icon.
function onCoverError(post: PostListItem, event: Event) {
  const img = event.target as HTMLImageElement | null
  if (!img || img.dataset.coverFallback === 'true') {
    return
  }

  const original = resolveMediaUrl(post.cover_image ?? '')
  if (!original || original === img.src) {
    return
  }

  img.dataset.coverFallback = 'true'
  img.src = original
}

function formatViews(value: number | null | undefined) {
  const count = Math.max(0, Number(value) || 0)
  return `${new Intl.NumberFormat(locale.value).format(count)} ${t(count === 1 ? 'public.post.view' : 'public.post.views')}`
}

const readingTimeLabel = useReadingTimeLabel()

function contentLengthLabel(post: PostListItem) {
  const words = Number(post.word_count ?? 0)
  const cjk = Number(post.cjk_char_count ?? 0)
  if (!words && !cjk) return ''
  const formatter = new Intl.NumberFormat(locale.value)
  const parts: string[] = []
  if (cjk) parts.push(`${formatter.format(cjk)} ${t('public.post.chars')}`)
  if (words) parts.push(`${formatter.format(words)} ${t('public.post.words')}`)
  return parts.join(' · ')
}

function postExcerpt(post: PostListItem) {
  return post.summary?.trim() || post.excerpt?.trim() || ''
}
</script>

<style scoped>
.post-card-grid {
  --post-card-grid-min: 20rem;
  --post-card-grid-single-max: 24rem;

  gap: clamp(1rem, 1.5vw, 2rem);
  display: grid;
  align-items: start;
  justify-content: stretch;
  grid-template-columns: minmax(0, 1fr);
}

/* A lone grid item should keep a normal tile width instead of being stretched
   across the full row by auto-fit. */
.post-card-grid.post-card-grid--single {
  justify-content: start;
  grid-template-columns: minmax(0, min(100%, var(--post-card-grid-single-max)));
}

.post-card-grid-item {
  aspect-ratio: 1 / 1;
  grid-template-rows: minmax(0, 42%) minmax(0, 1fr);
}

.post-card-list {
  display: grid;
  gap: clamp(1rem, 1.8vw, 1.5rem);
  grid-template-columns: minmax(0, 1fr);
}

.post-card-list-item {
  min-height: 11rem;
  grid-template-columns: minmax(7rem, 34%) minmax(0, 1fr);
}

@media (min-width: 640px) {
  .post-card-grid {
    grid-template-columns: repeat(auto-fit, minmax(min(var(--post-card-grid-min), 100%), 1fr));
  }

  .post-card-grid-item {
    justify-self: stretch;
    width: 100%;
  }
}

@media (min-width: 768px) {
  .post-card-grid-fixed {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .post-card-list-item {
    grid-template-columns: minmax(12rem, 18rem) minmax(0, 1fr);
  }
}

@media (max-width: 420px) {
  .post-card-list-item {
    min-height: 9.5rem;
    grid-template-columns: minmax(5.75rem, 30%) minmax(0, 1fr);
  }
}
</style>
