<template>
  <div class="mediatext-nodeview overflow-hidden rounded-[var(--pb-radius-card-inner)] border border-[var(--pb-divider)]" :style="blockStyle">
    <div class="mediatext-row" :data-media-position="mediaPosition">
      <div class="mediatext-media" :style="{ flex: `0 0 ${(ratio * 100).toFixed(2)}%` }">
        <div v-if="mediaTitle && mediaTitlePosition === 'top'" class="px-2 py-1 text-center text-sm text-[var(--pb-text-subtle)]">{{ mediaTitle }}</div>
        <div class="relative">
          <template v-if="mediaItems.length">
            <img
              v-if="showImagePreview"
              :src="resolvedMediaSrc"
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
        </div>
        <div v-if="mediaTitle && mediaTitlePosition === 'bottom'" class="px-2 py-1 text-center text-sm text-[var(--pb-text-subtle)]">{{ mediaTitle }}</div>
      </div>

      <div class="mediatext-divider" aria-hidden="true" />

      <div class="mediatext-text">
        <ContentRenderer v-for="(child, i) in props.node.content ?? []" :key="i" :node="child" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import type { JsonContent } from '~/types/content'
import ContentRenderer from './ContentRenderer.vue'
import MediaFileList from './MediaFileList.vue'
import { mediaFileKind, mediaFilesFromAttrs } from '~/utils/mediaFiles'
import { extractMediaHash } from '~/composables/useMediaUrl'
import { importedImagePreset, importedLayoutPreset, mediaFraction } from '~/utils/blockPresentation'
import { contentImageDimensions, contentImageSrcset, contentImageSizes, fallbackContentImage } from '~/utils/contentImage'
import '~/assets/css/block-presentation.css'

const props = defineProps<{
  node: JsonContent
}>()

const { resolveMediaUrl, toPublicMediaVariantUrl } = useMediaUrl()

const mediaItems = computed(() => mediaFilesFromAttrs(props.node.attrs))
const primaryMediaItem = computed(() => mediaItems.value[0] ?? null)
const showImagePreview = computed(() => mediaItems.value.length === 1 && primaryMediaItem.value ? mediaFileKind(primaryMediaItem.value) === 'image' : false)
const mediaSrc = computed(() => primaryMediaItem.value?.src ?? '')
const preset = computed(() => importedImagePreset(props.node.attrs ?? {}, true))
const srcset = computed(() => extractMediaHash(mediaSrc.value) ? contentImageSrcset(props.node.attrs?.imageSources, mediaSrc.value, size => toPublicMediaVariantUrl(mediaSrc.value, size)) : undefined)
const dimensions = computed(() => srcset.value ? contentImageDimensions(props.node.attrs, true) : null)
const sizes = computed(() => srcset.value ? contentImageSizes(preset.value, Boolean(dimensions.value)) : undefined)
const mediaAlt = computed(() => primaryMediaItem.value?.alt || String(props.node.attrs?.mediaAlt ?? ''))
const mediaTitle = computed(() => String(props.node.attrs?.mediaTitle ?? ''))
const mediaTitlePosition = computed(() => String(props.node.attrs?.mediaTitlePosition ?? 'bottom'))
const mediaPosition = computed(() => String(props.node.attrs?.mediaPosition ?? 'left'))
const blockWidth = computed(() => String(props.node.attrs?.blockWidth ?? 'content'))
const ratio = computed(() => mediaFraction(importedLayoutPreset(props.node.attrs ?? {}, 2, true), mediaPosition.value))
const resolvedMediaSrc = computed(() => resolveMediaUrl(mediaSrc.value))

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

</script>

<style scoped>
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

.mediatext-divider {
  width: 6px;
  background: transparent;
  border-left: 1px solid var(--pb-divider);
  border-right: 1px solid var(--pb-divider);
  flex: 0 0 auto;
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
