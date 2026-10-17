<template>
  <div v-if="node.type === 'doc'" class="pb-prose">
    <ContentRenderer v-for="(child, index) in visibleDocChildren" :key="index" :node="child" />
  </div>
  <ContentText v-else-if="node.type === 'text'" :text="node.text ?? ''" :marks="node.marks" />
  <br v-else-if="node.type === 'hardBreak'">
    <hr v-else-if="node.type === 'horizontalRule'" class="w-full" :style="separatorStyle">
    <NodeImage v-else-if="node.type === 'image'" :node="node" />
    <NodeCodeBlock v-else-if="node.type === 'codeBlock'" :node="node" />
    <NodeDiffBlock v-else-if="node.type === 'diffBlock'" :node="node" />
    <NodeMermaid v-else-if="node.type === 'mermaid'" :node="node" />
    <NodeBlockMath v-else-if="node.type === 'blockMath'" :node="node" />
    <NodeRubyUnit v-else-if="node.type === 'rubyUnit'" :node="node" />
    <NodeInlineMath v-else-if="node.type === 'inlineMath'" :node="node" />
    <NodeAnnotationBlock v-else-if="node.type === 'annotationBlock'" :node="node" />
    <NodeCustomHtml v-else-if="node.type === 'customHtml'" :node="node" />
    <NodeVideoEmbed v-else-if="node.type === 'videoEmbed'" :node="node" />
    <NodeMediaText v-else-if="node.type === 'mediaText'" :node="node" />
    <NodeFilesBlock v-else-if="node.type === 'filesBlock'" :node="node" />
    <NodeColumnsBlock v-else-if="node.type === 'columnsBlock'" :node="node" />
    <NodeTabsBlock v-else-if="node.type === 'tabsBlock'" :node="node" />
    <NodeDialogueBlock v-else-if="node.type === 'dialogueBlock'" :node="node" />
    <NodeAccordionBlock v-else-if="node.type === 'accordionBlock'" :node="node" />
    <NodeQuoteBlock v-else-if="node.type === 'blockquote'" :node="node" />
    <NodeFootnotesBlock v-else-if="node.type === 'footnotesBlock'" :node="node" />
  <component :is="tag" v-else :id="nodeId" :class="nodeClass">
    <ContentRenderer v-for="(child, index) in node.content ?? []" :key="index" :node="child" />
  </component>
</template>

<script setup lang="ts">
import type { JsonContent } from '~/types/content'
import { normalizePresentationNode } from '~/utils/blockPresentation'
import { flattenContentText } from '~/utils/contentText'

const NodeImage = defineAsyncComponent(() => import('./NodeImage.vue'))
const NodeCodeBlock = defineAsyncComponent(() => import('./NodeCodeBlock.vue'))
const NodeDiffBlock = defineAsyncComponent(() => import('./NodeDiffBlock.vue'))
const NodeMermaid = defineAsyncComponent(() => import('./NodeMermaid.vue'))
const NodeBlockMath = defineAsyncComponent(() => import('./NodeBlockMath.vue'))
const NodeRubyUnit = defineAsyncComponent(() => import('./NodeRubyUnit.vue'))
const NodeInlineMath = defineAsyncComponent(() => import('./NodeInlineMath.vue'))
const NodeAnnotationBlock = defineAsyncComponent(() => import('./NodeAnnotationBlock.vue'))
const NodeCustomHtml = defineAsyncComponent(() => import('./NodeCustomHtml.vue'))
const NodeVideoEmbed = defineAsyncComponent(() => import('./NodeVideoEmbed.vue'))
const NodeMediaText = defineAsyncComponent(() => import('./NodeMediaText.vue'))
const NodeFilesBlock = defineAsyncComponent(() => import('./NodeFilesBlock.vue'))
const NodeColumnsBlock = defineAsyncComponent(() => import('./NodeColumnsBlock.vue'))
const NodeTabsBlock = defineAsyncComponent(() => import('./NodeTabsBlock.vue'))
const NodeDialogueBlock = defineAsyncComponent(() => import('./NodeDialogueBlock.vue'))
const NodeAccordionBlock = defineAsyncComponent(() => import('./NodeAccordionBlock.vue'))
const NodeQuoteBlock = defineAsyncComponent(() => import('./NodeQuoteBlock.vue'))
const NodeFootnotesBlock = defineAsyncComponent(() => import('./NodeFootnotesBlock.vue'))

const props = defineProps<{
  node: JsonContent
}>()

const node = computed(() => normalizePresentationNode(props.node))

const tag = computed(() => {
  switch (props.node.type) {
    case 'paragraph':
      return 'p'
    case 'heading':
      return headingTag(props.node.attrs?.level)
    case 'bulletList':
      return 'ul'
    case 'orderedList':
      return 'ol'
    case 'listItem':
      return 'li'
    case 'table':
      return 'table'
    case 'tableRow':
      return 'tr'
    case 'tableHeader':
      return 'th'
    case 'tableCell':
      return 'td'
    case 'blockquote':
      return 'blockquote'
    case 'footnotesBlock':
      return 'section'
    default:
      return 'div'
  }
})

const nodeClass = computed(() => {
  switch (props.node.type) {
    case 'doc':
      return 'pb-prose'
    case 'bulletList':
      return 'list-disc pl-6'
    case 'orderedList':
      return 'list-decimal pl-6'
    case 'blockquote':
      return 'border-l-4 border-[var(--pb-link)] pl-4 text-[var(--pb-text-muted)]'
    case 'table':
      return 'my-6 w-full border-collapse overflow-hidden rounded-[var(--pb-radius-lg)]'
    case 'tableHeader':
      return 'border border-[var(--pb-divider)] bg-[var(--pb-surface-subtle)] p-2 font-semibold'
    case 'tableCell':
      return 'border border-[var(--pb-divider)] p-2 align-top'
    case 'footnotesBlock':
      return 'footnotes-block'
    default:
      return undefined
  }
})

const nodeId = computed(() => {
  if (props.node.type !== 'heading') {
    return undefined
  }

  return slugifyHeading(flattenContentText(props.node))
})

const visibleDocChildren = computed(() => {
  return props.node.content ?? []
})

const separatorStyle = computed(() => {
  if (props.node.type !== 'horizontalRule') {
    return undefined
  }

  const styleType = String(props.node.attrs?.styleType ?? 'solid')
  return {
    border: 0,
    borderTop: `1px ${['solid', 'dashed', 'dotted'].includes(styleType) ? styleType : 'solid'} var(--pb-divider)`,
    margin: 'var(--space-lg, 1rem) 0'
  }
})

function headingTag(level: unknown) {
  const safeLevel = Number(level)
  if ([1, 2, 3, 4, 5, 6].includes(safeLevel)) {
    return `h${safeLevel}`
  }
  return 'h2'
}

</script>
