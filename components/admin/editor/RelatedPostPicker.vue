<template>
  <Teleport to="body">
    <Transition name="related-post-picker">
      <div
        v-if="open"
        class="pointer-events-auto fixed inset-0 z-[1200] flex items-center justify-center p-2 sm:p-4"
        @wheel.self.prevent
        @touchmove.self.prevent
      >
        <button
          type="button"
          class="absolute inset-0 bg-black/50"
          :aria-label="t('admin.common.close')"
          @wheel.prevent
          @touchmove.prevent
          @click="close"
        />
        <section
          role="dialog"
          aria-modal="true"
          :aria-label="headingTitle"
          data-testid="related-post-picker"
          class="relative flex max-h-[calc(100dvh-1rem)] w-full max-w-xl flex-col overflow-hidden rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] shadow-[var(--pb-shadow-lg)] sm:max-h-[85vh]"
        >
          <header class="flex items-start justify-between gap-3 border-b border-[var(--pb-divider)] px-4 py-3">
            <div class="min-w-0">
              <h2 class="text-base font-semibold text-[var(--pb-text)]">{{ headingTitle }}</h2>
              <p class="text-xs text-[var(--pb-text-subtle)]">{{ headingDescription }}</p>
            </div>
            <UButton type="button" icon="i-lucide-x" size="xs" color="neutral" variant="ghost" :aria-label="t('admin.common.close')" @click="close" />
          </header>

          <div class="min-h-0 flex-1 overflow-y-auto p-4">
            <div class="grid gap-3">
              <UInput
                v-model="query"
                :placeholder="t('admin.editor.relatedPost.placeholder')"
                icon="i-lucide-search"
                autofocus
              />

              <div v-if="loading" class="py-8 text-center text-sm text-[var(--pb-text-subtle)]">{{ t('admin.editor.relatedPost.searching') }}</div>
              <ul v-else-if="visibleResults.length" class="max-h-64 divide-y divide-[var(--pb-divider)] overflow-y-auto rounded-[var(--pb-radius-md)] border border-[var(--pb-divider)]">
                <li v-for="item in visibleResults" :key="item.slug">
                  <button
                    type="button"
                    class="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors enabled:hover:bg-[var(--pb-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-60"
                    :disabled="item.added"
                    @click="confirm(item)"
                  >
                    <UIcon :name="item.added ? 'i-lucide-check' : 'i-lucide-file-text'" class="size-4 shrink-0 self-start mt-0.5 text-[var(--pb-text-subtle)]" />
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm font-medium text-[var(--pb-text)]">{{ item.title }}</div>
                      <div class="truncate text-xs text-[var(--pb-text-subtle)]">/blog/{{ item.slug }}</div>
                    </div>
                    <UBadge v-if="item.added" color="neutral" variant="subtle" size="sm" class="shrink-0">{{ t('admin.editor.relatedPost.alreadyAdded') }}</UBadge>
                  </button>
                </li>
              </ul>
              <div v-else-if="query.trim()" class="rounded-[var(--pb-radius-md)] border border-dashed border-[var(--pb-divider)] p-4 text-center text-sm text-[var(--pb-text-subtle)]">
                {{ t('admin.editor.relatedPost.noPosts') }}
              </div>
              <div v-else class="rounded-[var(--pb-radius-md)] border border-dashed border-[var(--pb-divider)] p-4 text-center text-sm text-[var(--pb-text-subtle)]">
                {{ t('admin.editor.relatedPost.startTyping') }}
              </div>
            </div>
          </div>

          <footer class="flex justify-end gap-2 border-t border-[var(--pb-divider)] px-4 py-3">
            <UButton type="button" variant="ghost" color="neutral" @click="close">{{ t('admin.editor.relatedPost.cancel') }}</UButton>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

interface PostSuggestion {
  id: string
  slug: string
  title: string
}

const props = withDefaults(defineProps<{
  open: boolean
  currentPostId?: string
  currentSlug?: string
  selectedIds?: string[]
  selectedSlugs?: string[]
  /** 'related' — the publish-time related-post picker. 'embed' — insert an embedded post node. */
  mode?: 'related' | 'embed'
}>(), {
  currentPostId: '',
  currentSlug: '',
  selectedIds: () => [],
  selectedSlugs: () => [],
  mode: 'related'
})
const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'confirm', value: { id: string, slug: string, title: string, target: string, label: string }): void
}>()

const { t } = useI18n()
const isEmbedMode = computed(() => props.mode === 'embed')
const headingTitle = computed(() => isEmbedMode.value ? t('admin.editor.postEmbed.pickerTitle') : t('admin.editor.relatedPost.title'))
const headingDescription = computed(() => isEmbedMode.value ? t('admin.editor.postEmbed.pickerDescription') : t('admin.editor.relatedPost.description'))
const query = ref('')
const loading = ref(false)
const results = ref<PostSuggestion[]>([])
let debounceTimer: ReturnType<typeof setTimeout> | null = null

const visibleResults = computed(() => results.value
  .filter(item => item.id !== props.currentPostId && item.slug !== props.currentSlug)
  .map(item => ({
    ...item,
    added: !isEmbedMode.value && (props.selectedIds.includes(item.id) || props.selectedSlugs.includes(item.slug))
  })))

watch(() => props.open, (next) => {
  if (next) {
    query.value = ''
    results.value = []
    void runSearch()
    window.addEventListener('keydown', onKeyDown)
  } else {
    window.removeEventListener('keydown', onKeyDown)
  }
})

watch(query, () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => { void runSearch() }, 200)
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  window.removeEventListener('keydown', onKeyDown)
})

// Escape must not bubble to the parent Post settings UModal, which would close it too.
function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    close()
  }
}

async function runSearch() {
  const q = query.value.trim()
  loading.value = true
  try {
    const response = await $fetch<{ items: PostSuggestion[] }>('/api/admin/posts/search', {
      params: { q }
    })
    results.value = response.items ?? []
  } catch {
    results.value = []
  } finally {
    loading.value = false
  }
}

function confirm(item: PostSuggestion & { added?: boolean }) {
  if (item.added) return
  emit('confirm', { id: item.id, slug: item.slug, title: item.title, target: item.slug, label: item.title })
  close()
}

function close() {
  emit('update:open', false)
}
</script>

<style scoped>
.related-post-picker-enter-active,
.related-post-picker-leave-active {
  transition: opacity 0.18s ease;
}

.related-post-picker-enter-from,
.related-post-picker-leave-to {
  opacity: 0;
}
</style>
