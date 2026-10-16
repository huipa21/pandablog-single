<template>
  <div class="theme-scope min-h-screen bg-[var(--pb-app-bg)] px-5 py-8 sm:px-6 lg:px-8">
    <div class="post-shell mx-auto grid min-w-0 gap-8">
      <BlogPostArticle v-if="previewPost" :post="previewPost" variant="preview" :edit-link="editLink" />

      <template v-else>
        <UButton :to="editLink" variant="ghost" color="neutral" icon="i-lucide-arrow-left" class="mb-4 -ml-2 justify-self-start">
          {{ t('admin.editor.preview.backToEditor') }}
        </UButton>
        <UAlert
          color="warning"
          icon="i-lucide-file-warning"
          :title="t('admin.editor.preview.missingTitle')"
          :description="t('admin.editor.preview.missingDescription')"
        />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { JsonContent, PostRecord, TagRecord } from '~/types/content'

definePageMeta({ layout: false })

interface LocalDraftPayload {
  title?: string
  slug?: string
  summary?: string
  cover_image?: string
  category_ids?: string[]
  tag_ids?: string[]
  category_names?: string[]
  tag_names?: string[]
  visibility?: string
  password?: string
  password_hint?: string
  related_post_ids?: string[]
  content_json?: JsonContent
  savedAt?: string
}

const route = useRoute()
const { t } = useI18n()
const id = computed(() => String(route.params.id))
const editLink = computed(() => `/admin/posts/${encodeURIComponent(id.value)}`)
const previewPost = shallowRef<PostRecord | null>(null)

useHead(() => ({ title: t('admin.editor.preview.title') }))

onMounted(() => {
  previewPost.value = loadPreviewPost()
})

function loadPreviewPost(): PostRecord | null {
  const localDraft = readLocalDraft()
  if (!localDraft) return null

  const now = localDraft.savedAt ?? new Date().toISOString()
  const postRecord: PostRecord = {
    id: id.value,
    title: localDraft.title?.trim() || t('admin.editor.noTitle'),
    slug: localDraft.slug?.trim() || id.value,
    summary: localDraft.summary ?? '',
    content_json: localDraft.content_json ?? emptyDoc(),
    status: 'draft',
    cover_image: localDraft.cover_image ?? '',
    published_at: null,
    created_at: now,
    updated_at: now,
    view_count: 0,
    word_count: 0,
    cjk_char_count: 0,
    visibility: localDraft.visibility === 'private' || localDraft.visibility === 'password' ? localDraft.visibility : 'public',
    password_hint: localDraft.password_hint ?? null,
    tag_ids: localDraft.tag_ids ?? [],
    category_ids: localDraft.category_ids ?? [],
    tags: buildTags(localDraft.tag_names),
    categories: [],
    related_post_ids: localDraft.related_post_ids ?? [],
    related_posts: []
  }

  return markRaw(postRecord)
}

function readLocalDraft(): LocalDraftPayload | null {
  try {
    const raw = localStorage.getItem(`pb-post-local-${id.value}`)
    if (!raw) return null
    return JSON.parse(raw) as LocalDraftPayload
  } catch {
    return null
  }
}

function buildTags(names: string[] | undefined): TagRecord[] {
  return (names ?? [])
    .map(name => name.trim())
    .filter(Boolean)
    .map(name => ({ id: name, name, slug: slugifyTag(name) }))
}

function slugifyTag(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '-')
}
</script>

<style scoped>
.post-shell {
  width: 100%;
  max-width: min(100%, var(--pb-layout-content-max));
}

@media (max-width: 767px) {
  .post-shell {
    max-width: none;
  }
}
</style>