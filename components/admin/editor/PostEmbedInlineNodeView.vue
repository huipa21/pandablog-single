<template>
  <NodeViewWrapper
    as="span"
    class="post-embed-inline-nodeview"
    data-type="post-embed-inline"
    :data-post-id="postId"
    contenteditable="false"
    @mousedown="selectNode"
  >
    <span v-if="postId && resolved" class="post-embed-chip">
      <UIcon name="i-lucide-file-text" class="size-3.5 shrink-0" />
      <span class="truncate">{{ displayTitle }}</span>
      <UIcon v-if="resolved.status !== 'published'" name="i-lucide-eye-off" class="size-3 shrink-0 opacity-70" />
    </span>

    <span v-else-if="postId && missing && !loading" class="post-embed-chip post-embed-chip-unavailable" :title="t('admin.editor.postEmbed.unavailable')">
      <UIcon name="i-lucide-circle-alert" class="size-3.5 shrink-0" />
      <span class="truncate">{{ fallbackTitle }}</span>
    </span>

    <span v-else class="post-embed-chip post-embed-chip-empty" role="button" tabindex="0" @click="emitPick" @keydown.enter.prevent="emitPick">
      <UIcon name="i-lucide-newspaper" class="size-3.5 shrink-0" />
      <span>{{ t('admin.editor.postEmbed.inlinePlaceholder') }}</span>
    </span>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'

const props = defineProps(nodeViewProps)
const { t } = useI18n()

const postId = computed(() => String(props.node.attrs.postId ?? ''))
const fallbackTitle = computed(() => String(props.node.attrs.title ?? ''))
const customLabel = computed(() => String(props.node.attrs.customLabel ?? '').trim())
const { post: resolved, loading, missing } = usePostEmbedLookup(postId)

const displayTitle = computed(() => customLabel.value || resolved.value?.title || fallbackTitle.value)

function emitPick() {
  if (!props.editor.isEditable) return
  props.editor.view.dom.dispatchEvent(new CustomEvent('postembed-pick', {
    bubbles: true,
    detail: { nodePos: getSafePos() }
  }))
}

function selectNode(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target && target.closest('button, a')) {
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
</script>

<style scoped>
.post-embed-inline-nodeview {
  display: inline;
}

.post-embed-chip {
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
  transition: background 140ms ease, border-color 140ms ease;
}

.post-embed-chip:hover {
  background: var(--pb-surface-subtle);
  border-color: var(--pb-selected-border);
}

.post-embed-chip-unavailable {
  color: var(--pb-text-subtle);
  text-decoration: line-through;
}

.post-embed-chip-empty {
  cursor: pointer;
  color: var(--pb-text-subtle);
  border-style: dashed;
}
</style>
