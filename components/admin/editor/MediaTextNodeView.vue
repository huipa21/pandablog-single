<template>
  <NodeViewWrapper class="mediatext-nodeview overflow-hidden" data-node-view-wrapper :style="blockStyle">
    <div ref="rowEl" class="mediatext-row" :data-media-position="mediaPosition">
      <div class="mediatext-media" :style="mediaStyle" contenteditable="false" @mousedown="selectMediaTextNode">
        <div v-if="mediaTitle && mediaTitlePosition === 'top'" class="mediatext-caption px-2 py-1 text-center text-sm">{{ mediaTitle }}</div>
        <div class="relative">
          <template v-if="mediaItems.length">
            <img
              v-if="showImagePreview"
              :src="mediaSrc"
              :srcset="srcset"
              :sizes="sizes"
              :width="dimensions?.width"
              :height="dimensions?.height"
              :alt="mediaAlt"
              :data-size-preset="preset"
              class="content-image block rounded-md"
              loading="lazy"
              @error="fallbackContentImage"
            >
            <MediaFileList v-else :files="mediaItems" density="compact" />
          </template>
          <div v-else class="mediatext-empty flex h-40 w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed px-3 text-sm">
            <UIcon name="i-lucide-image-plus" class="mediatext-empty-icon size-6" />
            <span class="text-xs">{{ t('admin.editor.nodeViews.addMediaDescription') }}</span>
            <div class="mt-1 flex flex-wrap gap-2">
              <button type="button" class="mediatext-pick-button rounded-md px-2.5 py-1 text-xs" @click="emitPick('library')">
                <UIcon name="i-lucide-images" class="mr-1 inline size-3.5" /> {{ t('admin.editor.nodeViews.mediaLibrary') }}
              </button>
              <button type="button" class="mediatext-pick-button rounded-md px-2.5 py-1 text-xs" @click="emitPick('upload')">
                <UIcon name="i-lucide-upload" class="mr-1 inline size-3.5" /> {{ t('admin.editor.nodeViews.uploadFile') }}
              </button>
              <button type="button" class="mediatext-pick-button rounded-md px-2.5 py-1 text-xs" @click="emitPick('url')">
                <UIcon name="i-lucide-link" class="mr-1 inline size-3.5" /> {{ t('admin.editor.nodeViews.pasteUrl') }}
              </button>
            </div>
          </div>
          <button
            v-if="mediaItems.length"
            type="button"
            class="mediatext-change-button absolute right-1 top-1 rounded px-1.5 py-0.5 text-[10px] shadow-sm"
            @click="emitPick('library')"
          >{{ t('admin.editor.nodeViews.change') }}</button>
        </div>
        <div v-if="mediaTitle && mediaTitlePosition === 'bottom'" class="mediatext-caption px-2 py-1 text-center text-sm">{{ mediaTitle }}</div>
      </div>

      <div class="mediatext-divider" contenteditable="false" />

      <NodeViewContent class="mediatext-text" />
    </div>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { NodeViewContent, NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import MediaFileList from '~/components/content/MediaFileList.vue'
import { mediaFileKind, mediaFilesFromAttrs } from '~/utils/mediaFiles'
import { extractMediaHash, useMediaUrl } from '~/composables/useMediaUrl'
import { importedImagePreset, importedLayoutPreset, mediaFraction } from '~/utils/blockPresentation'
import { contentImageDimensions, contentImageSrcset, contentImageSizes, fallbackContentImage } from '~/utils/contentImage'
import '~/assets/css/block-presentation.css'

const props = defineProps(nodeViewProps)
const { t } = useI18n()
const { resolveMediaUrl, toPublicMediaVariantUrl } = useMediaUrl()

const mediaItems = computed(() => mediaFilesFromAttrs(props.node.attrs))
const primaryMediaItem = computed(() => mediaItems.value[0] ?? null)
const showImagePreview = computed(() => mediaItems.value.length === 1 && primaryMediaItem.value ? mediaFileKind(primaryMediaItem.value) === 'image' : false)
const baseMediaSrc = computed(() => resolveMediaUrl(primaryMediaItem.value?.src ?? ''))
const mediaSrc = baseMediaSrc
const preset = computed(() => importedImagePreset(props.node.attrs, true))
const srcset = computed(() => {
  const raw = primaryMediaItem.value?.src ?? ''
  return extractMediaHash(raw) ? contentImageSrcset(props.node.attrs.imageSources, raw, size => toPublicMediaVariantUrl(raw, size)) : undefined
})
const dimensions = computed(() => srcset.value ? contentImageDimensions(props.node.attrs, true) : null)
const sizes = computed(() => srcset.value ? contentImageSizes(preset.value, Boolean(dimensions.value)) : undefined)
const mediaAlt = computed(() => primaryMediaItem.value?.alt || String(props.node.attrs.mediaAlt ?? ''))
const mediaTitle = computed(() => String(props.node.attrs.mediaTitle ?? ''))
const mediaTitlePosition = computed(() => String(props.node.attrs.mediaTitlePosition ?? 'bottom'))
const mediaPosition = computed(() => String(props.node.attrs.mediaPosition ?? 'left'))
const blockWidth = computed(() => String(props.node.attrs.blockWidth ?? 'content'))
const ratio = computed(() => mediaFraction(importedLayoutPreset(props.node.attrs, 2, true), mediaPosition.value))

const rowEl = ref<HTMLElement | null>(null)

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

const mediaStyle = computed(() => ({ flex: `0 0 ${(ratio.value * 100).toFixed(2)}%` }))

function emitPick(source: 'library' | 'upload' | 'url') {
  // Bubble a DOM event up to BlockEditor.vue which owns the media picker
  // (mediaText nodes are rendered via Vue NodeView, so component events
  // do not propagate normally to the wrapping editor component).
  rowEl.value?.dispatchEvent(new CustomEvent('mediatext-pick', {
    bubbles: true,
    detail: { source, nodePos: props.getPos?.() ?? null }
  }))
}

function selectMediaTextNode(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (target && target.closest('button, a, input, textarea, select')) {
    return
  }

  const getPos = props.getPos as (() => number) | number | undefined
  const nodePos = typeof getPos === 'function' ? getPos() : typeof getPos === 'number' ? getPos : null
  if (typeof nodePos !== 'number') return

  event.preventDefault()
  props.editor.chain().focus().setNodeSelection(nodePos).run()
}

</script>

<style scoped>
.mediatext-nodeview {
  border: 1px solid var(--pb-divider);
  border-radius: var(--pb-radius-card-inner);
  background: var(--pb-surface);
  color: var(--pb-text);
}

.mediatext-row {
  display: flex;
  align-items: stretch;
  width: 100%;
  min-height: 8rem;
}

.mediatext-row[data-media-position="right"] {
  flex-direction: row-reverse;
}

.mediatext-media {
  padding: var(--space-md, 0.75rem);
  background: var(--pb-surface-subtle);
  min-width: 0;
}

.mediatext-caption,
.mediatext-empty {
  color: var(--pb-text-subtle);
}

.mediatext-empty {
  border-color: var(--pb-divider-strong);
  background: var(--pb-card-bg);
}

.mediatext-empty-icon {
  color: var(--pb-icon-muted);
}

.mediatext-pick-button,
.mediatext-change-button {
  border: 1px solid var(--pb-divider-strong);
  background: color-mix(in srgb, var(--pb-surface) 88%, var(--pb-text) 12%);
  color: var(--pb-text-muted);
}

.mediatext-pick-button:hover,
.mediatext-change-button:hover {
  background: var(--pb-selected-bg);
  border-color: var(--pb-selected-border);
  color: var(--pb-text);
}

.mediatext-divider {
  width: 6px;
  background: transparent;
  border-left: 1px solid var(--pb-divider);
  border-right: 1px solid var(--pb-divider);
  transition: background-color 120ms ease;
  flex: 0 0 auto;
}

.mediatext-divider:hover {
  background: color-mix(in srgb, var(--pb-primary) 15%, transparent);
}

.mediatext-text {
  flex: 1 1 auto;
  padding: var(--space-md, 0.75rem) var(--space-lg, 1rem);
  min-width: 0;
}

@media (max-width: 48rem) {
  .mediatext-row,
  .mediatext-row[data-media-position="right"] {
    flex-direction: column;
  }

  .mediatext-media {
    flex: 0 0 auto !important;
    width: 100%;
  }

  .mediatext-divider {
    width: 100%;
    height: 6px;
    border-top: 1px solid var(--pb-divider);
    border-right: 0;
    border-bottom: 1px solid var(--pb-divider);
    border-left: 0;
  }
}
</style>
