<template>
  <NodeViewWrapper
    class="post-embed-nodeview"
    data-type="post-embed"
    :data-post-id="postId"
    :data-block-width="blockWidth"
    :style="blockStyle"
    contenteditable="false"
  >
    <div ref="rootEl" class="post-embed-surface" @mousedown="selectNode">

      <div v-if="postId && resolved" class="post-embed-card">
        <div v-if="showCover" class="post-embed-media">
          <img v-if="coverSrc" class="post-embed-cover" :src="coverSrc" :alt="displayTitle" loading="lazy" decoding="async">
          <div v-else class="post-embed-cover-fallback">
            <UIcon name="i-lucide-newspaper" class="size-10" />
          </div>
        </div>
        <div class="post-embed-body">
          <div class="post-embed-title-row">
            <UIcon name="i-lucide-file-text" class="size-4 shrink-0 text-[var(--pb-primary)]" />
            <span class="post-embed-title">{{ displayTitle }}</span>
          </div>
          <div class="post-embed-caption">
            <UIcon name="i-lucide-external-link" class="size-3 shrink-0" />
            <span>/blog/{{ resolved.slug }}</span>
          </div>
          <UBadge v-if="statusLabel" color="warning" variant="subtle" size="sm" class="self-start">{{ statusLabel }}</UBadge>
        </div>
      </div>

      <div v-else-if="postId && missing && !loading" class="post-embed-unavailable">
        <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0 text-[var(--pb-icon-muted)]" />
        <div class="min-w-0 flex-1">
          <div class="truncate text-sm font-medium text-[var(--pb-text)]">{{ fallbackTitle }}</div>
          <div class="text-xs text-[var(--pb-text-subtle)]">{{ t('admin.editor.postEmbed.unavailable') }}</div>
        </div>
        <UButton type="button" size="xs" color="neutral" variant="soft" icon="i-lucide-repeat" @click="emitPick">{{ t('admin.editor.postEmbed.changePost') }}</UButton>
      </div>

      <div v-else class="post-embed-empty">
        <UIcon name="i-lucide-newspaper" class="size-7 text-[var(--pb-icon-muted)]" />
        <div class="text-center">
          <div class="text-sm font-medium text-[var(--pb-text)]">{{ t('admin.editor.postEmbed.emptyTitle') }}</div>
          <div class="text-xs text-[var(--pb-text-subtle)]">{{ t('admin.editor.postEmbed.emptyDescription') }}</div>
        </div>
        <UButton type="button" size="xs" variant="soft" icon="i-lucide-search" @click="emitPick">{{ t('admin.editor.postEmbed.choosePost') }}</UButton>
      </div>

      <button
        v-if="postId"
        type="button"
        class="post-embed-change"
        @click="emitPick"
      >{{ t('admin.editor.postEmbed.changePost') }}</button>
    </div>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'

const props = defineProps(nodeViewProps)
const { t } = useI18n()
const { toPublicMediaVariantUrl } = useMediaUrl()
const rootEl = ref<HTMLElement | null>(null)

const postId = computed(() => String(props.node.attrs.postId ?? ''))
const fallbackTitle = computed(() => String(props.node.attrs.title ?? ''))
const customLabel = computed(() => String(props.node.attrs.customLabel ?? '').trim())
const blockWidth = computed(() => normalizeBlockWidth(String(props.node.attrs.blockWidth ?? 'content')))
const showCover = computed(() => props.node.attrs.showCover !== false)
const { post: resolved, loading, missing } = usePostEmbedLookup(postId)

const displayTitle = computed(() => customLabel.value || resolved.value?.title || fallbackTitle.value)
const statusLabel = computed(() => {
  if (!resolved.value) return ''
  if (resolved.value.status === 'draft') return t('admin.posts.status.draft')
  if (resolved.value.status === 'archived') return t('admin.posts.status.archived')
  return ''
})
const coverSrc = computed(() => toPublicMediaVariantUrl(resolved.value?.cover_image ?? '', 'medium'))

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
        width: 'calc(100% + 2 * (var(--pb-editor-gutter, 32px) + var(--pb-editor-gap, 8px)))',
        maxWidth: 'calc(100% + 2 * (var(--pb-editor-gutter, 32px) + var(--pb-editor-gap, 8px)))',
        position: 'relative' as const,
        left: '50%',
        transform: 'translateX(-50%)'
      }
    case 'content':
    default:
      return { width: '100%', maxWidth: '100%' }
  }
})

function emitPick() {
  if (!props.editor.isEditable) return
  rootEl.value?.dispatchEvent(new CustomEvent('postembed-pick', {
    bubbles: true,
    detail: { nodePos: getSafePos() }
  }))
}

function selectNode(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target && target.closest('button, a, input, textarea, select')) {
    return
  }
  const nodePos = getSafePos()
  if (nodePos === null) return
  event.preventDefault()
  props.editor.chain().focus().setNodeSelection(nodePos).run()
}

function getSafePos(): number | null {
  const getPos = props.getPos as (() => number) | number | undefined
  const nodePos = typeof getPos === 'function' ? getPos() : typeof getPos === 'number' ? getPos : null
  return typeof nodePos === 'number' ? nodePos : null
}

function normalizeBlockWidth(value: string) {
  return value === 'wide' || value === 'full-bleed' ? value : 'content'
}
</script>

<style scoped>
.post-embed-nodeview {
  display: block;
  margin: 1rem 0;
}

.post-embed-surface {
  position: relative;
}

.post-embed-card {
  display: flex;
  overflow: hidden;
  background: var(--pb-card-bg);
  border: 1px solid var(--pb-card-border);
  border-left: 3px solid var(--pb-primary);
  border-radius: var(--pb-radius-card-outer);
  box-shadow: var(--pb-shadow-md);
}

.post-embed-media {
  position: relative;
  flex: 0 0 auto;
  width: 8.5rem;
  overflow: hidden;
  background: var(--pb-surface-subtle);
}

.post-embed-cover,
.post-embed-cover-fallback {
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 6.5rem;
  align-items: center;
  justify-content: center;
  object-fit: cover;
}

.post-embed-cover-fallback {
  color: var(--pb-icon-muted);
}

.post-embed-body {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
  flex: 1;
  align-content: center;
  padding: 0.85rem 1rem;
}

.post-embed-title-row {
  display: flex;
  gap: 0.5rem;
  align-items: center;
  min-width: 0;
}

.post-embed-title {
  overflow: hidden;
  font-size: 0.95rem;
  font-weight: 600;
  line-height: 1.35;
  color: var(--pb-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.post-embed-caption {
  display: flex;
  gap: 0.3rem;
  align-items: center;
  overflow: hidden;
  font-size: 0.75rem;
  color: var(--pb-text-subtle);
  text-overflow: ellipsis;
  white-space: nowrap;
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

.post-embed-empty {
  display: grid;
  gap: 0.5rem;
  justify-items: center;
  padding: 1.25rem 1rem;
  background: var(--pb-card-bg);
  border: 1px dashed var(--pb-divider);
  border-radius: var(--pb-radius-card-outer);
  color: var(--pb-text-subtle);
}

.post-embed-change {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  padding: 0.15rem 0.5rem;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--pb-text-subtle);
  background: var(--pb-card-bg);
  border: 1px solid var(--pb-divider);
  border-radius: var(--pb-radius-sm);
  opacity: 0;
  transition: opacity 140ms ease;
}

.post-embed-surface:hover .post-embed-change,
.post-embed-change:focus-visible {
  opacity: 1;
}

@media (max-width: 640px) {
  .post-embed-media {
    width: 6rem;
  }
}
</style>
