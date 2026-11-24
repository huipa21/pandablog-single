<template>
  <details open class="rounded-md border border-[var(--pb-divider)] bg-[var(--pb-card-bg)] p-3" data-testid="word-card-settings">
    <summary class="cursor-pointer text-sm font-semibold">{{ t('admin.editor.wordCard.settingsTitle') }}</summary>
    <div class="mt-3 space-y-3">
      <template v-if="word">
        <div class="rounded-[var(--pb-radius-md)] border border-[var(--pb-divider)] p-2.5">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="truncate font-[var(--pb-font-display)] text-lg font-semibold text-[var(--pb-text)]">{{ word.headword }}</p>
              <p v-if="word.pronunciation" class="truncate text-xs text-[var(--pb-text-muted)]">{{ word.pronunciation }}</p>
              <p class="mt-1 text-xs text-[var(--pb-text-subtle)]">
                {{ t('admin.editor.wordCard.selectedCount', { selected: selectedCount, total: word.senses.length }) }}
              </p>
            </div>
            <UBadge v-if="word.archived" color="warning" variant="subtle" size="xs">{{ t('public.wordCard.archived') }}</UBadge>
          </div>
        </div>

        <div class="flex flex-wrap gap-2">
          <UButton type="button" size="sm" variant="soft" icon="i-lucide-repeat" @click="pickerOpen = true">
            {{ t('admin.editor.wordCard.changeWord') }}
          </UButton>
          <UButton :to="`/admin/words?edit=${encodeURIComponent(word.id)}`" target="_blank" size="sm" color="neutral" variant="soft" icon="i-lucide-pencil">
            {{ t('admin.editor.wordCard.editWord') }}
          </UButton>
        </div>
      </template>

      <template v-else>
        <p class="text-xs text-[var(--pb-text-subtle)]">{{ t('admin.editor.wordCard.emptyDescription') }}</p>
        <UButton type="button" size="sm" variant="soft" icon="i-lucide-search" @click="pickerOpen = true">
          {{ t('admin.editor.wordCard.chooseWord') }}
        </UButton>
      </template>

      <div class="space-y-2">
        <h3 class="text-sm font-semibold">{{ t('admin.editor.settingsPanel.blockWidth') }}</h3>
        <USelect
          :model-value="normalizeWidth(attrs.blockWidth)"
          :items="widthItems"
          class="w-full"
          @update:model-value="updateAttrs({ blockWidth: normalizeWidth($event) })"
        />
      </div>
    </div>

    <WordCardPicker
      :open="pickerOpen"
      :initial-word-id="String(attrs.wordId ?? '')"
      :initial-sense-ids="normalizeSenseIds(attrs.senseIds)"
      :initial-target-language="String(attrs.targetLanguage ?? '')"
      @update:open="pickerOpen = $event"
      @confirm="applyPick"
    />
  </details>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { WordRecord } from '~/types/word'
import { normalizeSenseIds } from '~/utils/words'
import WordCardPicker from '../WordCardPicker.vue'

const props = defineProps<{
  editor: Editor | null
  attrs: Record<string, unknown>
  pos: number | null
}>()

const { t } = useI18n()
const editorStore = useEditorStore()
const pickerOpen = ref(false)

const widthItems = computed(() => [
  { label: t('admin.editor.settingsPanel.content'), value: 'content' },
  { label: t('admin.editor.settingsPanel.wide'), value: 'wide' },
  { label: t('admin.editor.settingsPanel.fullBleed'), value: 'full-bleed' }
])

const target = computed<{ node: ProseMirrorNode, pos: number } | null>(() => {
  const ed = props.editor
  // `props.attrs` is the reactive mirror of the selected node. Referencing it
  // makes the lookup rerun after a picker edit replaces the node attrs.
  if (!ed || props.pos === null || !ed.isEditable || !props.attrs) return null
  const node = ed.state.doc.nodeAt(props.pos)
  if (!node || node.type.name !== 'wordCard') return null
  return { node, pos: props.pos }
})

const selectedWordId = computed(() => String(props.attrs.wordId ?? ''))
const { word } = useWordCardLookup(selectedWordId)
const selectedCount = computed(() => {
  const ids = normalizeSenseIds(props.attrs.senseIds)
  if (!ids.length) return word.value?.senses.length ?? 0
  return word.value?.senses.filter(sense => ids.includes(sense.id)).length ?? ids.length
})

function updateAttrs(next: Record<string, unknown>) {
  const ed = props.editor
  const current = target.value
  if (!ed || !current) return
  const node = ed.state.doc.nodeAt(current.pos)
  if (!node) return
  const merged = { ...node.attrs, ...next }
  ed.view.dispatch(ed.state.tr.setNodeMarkup(current.pos, undefined, merged))
  editorStore.mergeSelectedBlockAttrs(merged)
}

function applyPick(value: { word: WordRecord, senseIds: string[], targetLanguage: string }) {
  updateAttrs({
    wordId: value.word.id,
    headword: value.word.headword,
    senseIds: value.senseIds,
    targetLanguage: value.targetLanguage
  })
  pickerOpen.value = false
}

function normalizeWidth(value: unknown) {
  const width = String(value ?? 'content')
  return width === 'wide' || width === 'full-bleed' ? width : 'content'
}
</script>
