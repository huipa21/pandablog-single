<template>
  <NodeViewWrapper class="imageblock-nodeview flex" :class="alignClass" :data-align="align" data-node-view-wrapper>
    <figure class="imageblock-figure relative inline-block" :class="{ 'is-selected': selected }" :data-size-preset="preset">
      <figcaption v-if="title && titlePosition === 'top'" class="text-center text-sm text-[var(--pb-text-subtle)]" contenteditable="false">{{ title }}</figcaption>
      <div class="relative inline-block w-full">
        <img v-if="src" :src="src" :srcset="srcset" :sizes="sizes" :width="dimensions?.width" :height="dimensions?.height" :alt="alt" class="imageblock-image block rounded-md" loading="lazy" draggable="false" @error="fallbackContentImage">
        <div v-else class="flex h-40 w-full items-center justify-center rounded-md border border-dashed border-[var(--pb-divider)] text-sm text-[var(--pb-text-subtle)]" contenteditable="false">{{ t('admin.editor.settingsPanel.sourceUrl') }}</div>
      </div>
      <figcaption v-if="title && titlePosition === 'bottom'" class="mt-2 text-center text-sm text-[var(--pb-text-subtle)]" contenteditable="false">{{ title }}</figcaption>
    </figure>
  </NodeViewWrapper>
</template>
<script setup lang="ts">
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { extractMediaHash, useMediaUrl } from '~/composables/useMediaUrl'
import { importedImagePreset } from '~/utils/blockPresentation'
import { contentImageDimensions, contentImageSrcset, contentImageSizes, fallbackContentImage } from '~/utils/contentImage'
import '~/assets/css/block-presentation.css'
const props = defineProps(nodeViewProps)
const { t } = useI18n()
const { resolveMediaUrl, toPublicMediaVariantUrl } = useMediaUrl()
const raw = computed(() => String(props.node.attrs.src ?? ''))
const src = computed(() => resolveMediaUrl(raw.value))
const srcset = computed(() => extractMediaHash(raw.value) ? contentImageSrcset(props.node.attrs.imageSources, raw.value, size => toPublicMediaVariantUrl(raw.value, size)) : undefined)
const dimensions = computed(() => srcset.value ? contentImageDimensions(props.node.attrs) : null)
const sizes = computed(() => srcset.value ? contentImageSizes(preset.value, Boolean(dimensions.value)) : undefined)
const preset = computed(() => importedImagePreset(props.node.attrs))
const alt = computed(() => String(props.node.attrs.alt ?? ''))
const title = computed(() => String(props.node.attrs.title ?? ''))
const titlePosition = computed(() => String(props.node.attrs.titlePosition ?? 'bottom'))
const align = computed(() => String(props.node.attrs.align ?? 'center'))
const alignClass = computed(() => align.value === 'left' ? 'justify-start' : align.value === 'right' ? 'justify-end' : 'justify-center')
const selected = computed(() => Boolean(props.selected))
</script>
<style scoped>
.imageblock-figure.is-selected {
  outline: 2px solid var(--pb-primary);
  outline-offset: 4px;
  border-radius: 0.5rem;
}
</style>
