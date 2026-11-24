<template>
  <details open class="rounded-md border border-[var(--pb-divider)] bg-[var(--pb-card-bg)] p-3" data-testid="post-embed-settings">
    <summary class="cursor-pointer text-sm font-semibold">{{ t('admin.editor.postEmbed.settingsTitle') }}</summary>
    <div class="mt-3 space-y-4">
      <div class="space-y-2">
        <h3 class="text-sm font-semibold">{{ t('admin.editor.postEmbed.display') }}</h3>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="option in displayOptions"
            :key="option"
            type="button"
            class="min-w-0 rounded-[var(--pb-radius-sm)] border p-2 text-xs"
            :class="mode === option ? 'border-[var(--pb-selected-border)] bg-[var(--pb-selected-bg)] ring-1 ring-[var(--pb-selected-border)]' : 'border-[var(--pb-divider)]'"
            :aria-pressed="mode === option"
            @click="convertDisplay(option)"
          >
            <span class="mb-2 block" aria-hidden="true">
              <UIcon v-if="option === 'card'" name="i-lucide-newspaper" class="mx-auto size-5" />
              <UIcon v-else name="i-lucide-file-text" class="mx-auto size-5" />
            </span>
            {{ t(`admin.editor.postEmbed.display_${option}`) }}
          </button>
        </div>
      </div>

      <div class="space-y-2">
        <h3 class="text-sm font-semibold">{{ t('admin.editor.postEmbed.customLabelTitle') }}</h3>
        <UInput
          :model-value="String(attrs.customLabel ?? '')"
          :placeholder="t('admin.editor.postEmbed.customLabelPlaceholder')"
          class="w-full"
          @update:model-value="updateAttrs({ customLabel: String($event ?? '') })"
        />
      </div>

      <template v-if="mode === 'card'">
        <UCheckbox
          :model-value="attrs.showCover !== false"
          :label="t('admin.editor.postEmbed.showCover')"
          @update:model-value="updateAttrs({ showCover: $event === true })"
        />
        <div class="space-y-2">
          <h3 class="text-sm font-semibold">{{ t('admin.editor.settingsPanel.blockWidth') }}</h3>
          <USelect
            :model-value="normalizeWidth(attrs.blockWidth)"
            :items="widthItems"
            class="w-full"
            @update:model-value="updateAttrs({ blockWidth: normalizeWidth($event) })"
          />
        </div>
      </template>

      <UButton
        type="button"
        size="sm"
        variant="soft"
        icon="i-lucide-repeat"
        class="w-full"
        @click="changePost"
      >{{ t('admin.editor.postEmbed.changePost') }}</UButton>
    </div>
  </details>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { NodeSelection } from '@tiptap/pm/state'

const props = defineProps<{
  editor: Editor | null
  attrs: Record<string, unknown>
  pos: number | null
}>()

const { t } = useI18n()
const editorStore = useEditorStore()

const widthItems = [
  { label: t('admin.editor.settingsPanel.content'), value: 'content' },
  { label: t('admin.editor.settingsPanel.wide'), value: 'wide' },
  { label: t('admin.editor.settingsPanel.fullBleed'), value: 'full-bleed' }
]

const target = computed<{ node: ProseMirrorNode, pos: number } | null>(() => {
  const ed = props.editor
  if (!ed || props.pos === null || !ed.isEditable) return null
  const node = ed.state.doc.nodeAt(props.pos)
  if (!node || (node.type.name !== 'postEmbed' && node.type.name !== 'postEmbedInline')) return null
  return { node, pos: props.pos }
})

const mode = computed(() => target.value?.node.type.name === 'postEmbedInline' ? 'inline' : 'card')
const displayOptions = ['card', 'inline'] as const

function updateAttrs(next: Record<string, unknown>) {
  const ed = props.editor, current = target.value
  if (!ed || !current) return
  const merged = { ...current.node.attrs, ...next }
  ed.view.dispatch(ed.state.tr.setNodeMarkup(current.pos, undefined, merged))
  editorStore.mergeSelectedBlockAttrs(merged)
}

/**
 * Toggle display between the block-level card and the inline chip. Inline vs
 * block is a schema-level property in Tiptap, so the setting converts the node
 * type in place, preserving the post anchor and all other attrs.
 */
function convertDisplay(next: 'card' | 'inline') {
  const ed = props.editor, current = target.value
  if (!ed || !current) return
  if (mode.value === next) return

  const attrs = { ...current.node.attrs }
  const { postEmbedNode, postEmbedInlineNode } = ed.schema.nodes

  if (next === 'inline') {
    // Card → chip: replace the top-level block with a paragraph holding the chip.
    if (!postEmbedInlineNode) return
    const chip = ed.schema.node(postEmbedInlineNode, attrs)
    const paragraph = ed.schema.nodes.paragraph?.create(null, [chip])
    if (!paragraph) return
    const tr = ed.state.tr.replaceWith(current.pos, current.pos + current.node.nodeSize, paragraph)
    tr.setSelection(NodeSelection.create(tr.doc, current.pos + 1))
    try {
      ed.view.dispatch(tr)
    } catch {
      // Container rejected the paragraph; keep the card as is.
    }
    return
  }

  // Chip → card: remove the chip from its text block, insert the card after it.
  if (!postEmbedNode) return
  const $pos = ed.state.doc.resolve(current.pos)
  const parentEnd = $pos.before($pos.depth) + $pos.parent.nodeSize
  const card = ed.schema.node(postEmbedNode, attrs)
  const tr = ed.state.tr
  tr.delete(current.pos, current.pos + current.node.nodeSize)
  tr.insert(parentEnd - current.node.nodeSize, card)
  tr.setSelection(NodeSelection.create(tr.doc, Math.min(parentEnd - current.node.nodeSize, tr.doc.content.size - 1)))
  try {
    ed.view.dispatch(tr)
  } catch {
    // The chip may live in a container that does not allow block nodes
    // (e.g. a nested list item) — leave the chip untouched instead of
    // crashing the editor transaction.
  }
}

function changePost() {
  const ed = props.editor, current = target.value
  if (!ed || !current) return
  ed.view.dom.dispatchEvent(new CustomEvent('postembed-pick', {
    bubbles: true,
    detail: { nodePos: current.pos }
  }))
}

function normalizeWidth(value: unknown) {
  const raw = String(value ?? 'content')
  return raw === 'wide' || raw === 'full-bleed' ? raw : 'content'
}
</script>
