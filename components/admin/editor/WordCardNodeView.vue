<template>
  <NodeViewWrapper
    class="word-card-nodeview"
    data-type="word-card"
    :data-word-id="wordId"
    :data-block-width="blockWidth"
    :style="blockStyle"
    contenteditable="false"
  >
    <div ref="rootEl" class="word-card-nodeview__surface" @mousedown="selectNode">
      <WordCard
        v-if="word && !missingSelection"
        :word="word"
        :sense-ids="senseIds"
        :target-language="targetLanguage"
      />

      <div v-else-if="missingSelection" class="word-card-nodeview__missing">
        <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="word-card-nodeview__title">{{ headword || word?.headword }}</p>
          <p class="word-card-nodeview__text">{{ t('admin.editor.wordCard.noSelectedSenses') }}</p>
        </div>
        <UButton type="button" size="xs" color="warning" variant="soft" icon="i-lucide-repeat" @click="emitPick">
          {{ t('admin.editor.wordCard.changeWord') }}
        </UButton>
      </div>

      <div v-else-if="wordId && missing && !loading" class="word-card-nodeview__missing">
        <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0" aria-hidden="true" />
        <div class="min-w-0 flex-1">
          <p class="word-card-nodeview__title">{{ headword || t('admin.editor.wordCard.unavailableTitle') }}</p>
          <p class="word-card-nodeview__text">{{ t('admin.editor.wordCard.unavailableDescription') }}</p>
        </div>
        <UButton type="button" size="xs" color="neutral" variant="soft" icon="i-lucide-repeat" @click="emitPick">
          {{ t('admin.editor.wordCard.changeWord') }}
        </UButton>
      </div>

      <div v-else-if="loading" class="word-card-nodeview__loading" aria-hidden="true">
        <USkeleton class="h-4 w-24" />
        <USkeleton class="mt-3 h-9 w-56" />
        <USkeleton class="mt-5 h-4 w-full" />
      </div>

      <div v-else class="word-card-nodeview__empty">
        <UIcon name="i-lucide-book-marked" class="size-7" aria-hidden="true" />
        <div class="text-center">
          <p class="word-card-nodeview__title">{{ t('admin.editor.wordCard.emptyTitle') }}</p>
          <p class="word-card-nodeview__text">{{ t('admin.editor.wordCard.emptyDescription') }}</p>
        </div>
        <UButton type="button" size="xs" variant="soft" icon="i-lucide-search" @click="emitPick">
          {{ t('admin.editor.wordCard.chooseWord') }}
        </UButton>
      </div>

      <div v-if="wordId" class="word-card-nodeview__actions">
        <NuxtLink
          v-if="word"
          :to="`/admin/words?edit=${encodeURIComponent(wordId)}`"
          target="_blank"
          rel="noopener"
          class="word-card-nodeview__action"
        >
          <UIcon name="i-lucide-pencil" class="size-3.5" aria-hidden="true" />
          {{ t('admin.editor.wordCard.editWord') }}
        </NuxtLink>
        <button type="button" class="word-card-nodeview__action" @click="emitPick">
          <UIcon name="i-lucide-repeat" class="size-3.5" aria-hidden="true" />
          {{ t('admin.editor.wordCard.changeWord') }}
        </button>
      </div>
    </div>
  </NodeViewWrapper>
</template>

<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { NodeViewWrapper, nodeViewProps } from '@tiptap/vue-3'
import { hasSenseSelection, normalizeSenseIds, selectWordSenses } from '~/utils/words'
import WordCard from '~/components/content/WordCard.vue'

const props = defineProps(nodeViewProps)
const { t } = useI18n()
const rootEl = ref<HTMLElement | null>(null)

const wordId = computed(() => String(props.node.attrs.wordId ?? '').trim())
const headword = computed(() => String(props.node.attrs.headword ?? '').trim())
const senseIds = computed(() => normalizeSenseIds(props.node.attrs.senseIds))
const targetLanguage = computed(() => String(props.node.attrs.targetLanguage ?? ''))
const blockWidth = computed(() => normalizeBlockWidth(String(props.node.attrs.blockWidth ?? 'content')))
const { word, loading, missing } = useWordCardLookup(wordId)
const missingSelection = computed(() => Boolean(
  word.value && hasSenseSelection(senseIds.value) && selectWordSenses(word.value, senseIds.value).length === 0
))

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
  rootEl.value?.dispatchEvent(new CustomEvent('wordcard-pick', {
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
.word-card-nodeview {
  display: block;
  margin: 1rem 0;
}

.word-card-nodeview__surface {
  position: relative;
}

.word-card-nodeview__missing,
.word-card-nodeview__empty,
.word-card-nodeview__loading {
  display: flex;
  gap: 0.65rem;
  align-items: center;
  padding: 1.25rem;
  color: var(--pb-text-muted);
  background: var(--pb-surface-subtle);
  border: 1px dashed var(--pb-border-strong);
  border-radius: var(--pb-radius-card-outer);
}

.word-card-nodeview__empty {
  flex-direction: column;
}

.word-card-nodeview__loading {
  flex-direction: column;
  align-items: stretch;
  background: var(--pb-card-bg);
  border-style: solid;
}

.word-card-nodeview__title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
  color: var(--pb-text);
}

.word-card-nodeview__text {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  color: var(--pb-text-subtle);
}

.word-card-nodeview__actions {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  z-index: 2;
  display: flex;
  gap: 0.25rem;
  padding: 0.2rem;
  opacity: 0;
  background: var(--pb-card-bg);
  border: 1px solid var(--pb-divider);
  border-radius: var(--pb-radius-sm);
  box-shadow: var(--pb-shadow-sm);
  transition: opacity 140ms ease;
}

.word-card-nodeview__surface:hover .word-card-nodeview__actions,
.word-card-nodeview__surface:focus-within .word-card-nodeview__actions {
  opacity: 1;
}

.word-card-nodeview__action {
  display: inline-flex;
  gap: 0.25rem;
  align-items: center;
  padding: 0.2rem 0.4rem;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--pb-text-muted);
  background: transparent;
  border: 0;
  border-radius: var(--pb-radius-sm);
  cursor: pointer;
}

.word-card-nodeview__action:hover {
  color: var(--pb-text);
  background: var(--pb-surface-subtle);
}

@media (hover: none) {
  .word-card-nodeview__actions {
    opacity: 1;
  }
}
</style>
