<template>
  <div class="block-settings-panel space-y-4">
    <p v-if="!blockName" class="text-sm text-[var(--pb-text-subtle)]">{{ t('admin.editor.settingsPanel.selectBlock') }}</p>
    <template v-else>
      <div class="flex items-center gap-2 rounded-md border border-[var(--pb-divider)] p-3">
        <UIcon :name="blockDefinition?.icon ?? 'i-lucide-box'" class="size-4" />
        <strong>{{ blockDefinition?.title ?? blockName }}</strong>
      </div>
      <DialogueSettings v-if="blockName === 'dialogueBlock'" :editor="editor" :attrs="attrs" :pos="selected?.pos ?? null" @update="updateAttrs" />
      <PostEmbedSettings v-else-if="blockName === 'postEmbed' || blockName === 'postEmbedInline'" :editor="editor" :attrs="attrs" :pos="selected?.pos ?? null" />
      <div v-else class="space-y-3 rounded-md border border-[var(--pb-divider)] p-3" :data-code-settings="blockName === 'codeBlock' ? '' : undefined">
        <UFormField v-for="field in fields" :key="field.key" :label="label(field.label)">
          <USelect v-if="field.items" class="w-full" :model-value="String(attrs[field.key] ?? field.fallback ?? '')" :items="field.items" @update:model-value="setField(field, $event)" />
          <UCheckbox v-else-if="field.boolean" :model-value="Boolean(attrs[field.key] ?? field.fallback)" :label="label(field.label)" @update:model-value="setField(field, $event)" />
          <UTextarea v-else-if="field.multiline" :rows="8" :model-value="String(attrs[field.key] ?? '')" @update:model-value="setField(field, $event)" />
          <UInput v-else class="w-full" :model-value="String(attrs[field.key] ?? '')" @update:model-value="setField(field, $event)" />
        </UFormField>
        <UFormField v-if="blockName === 'columnsBlock'" :label="label('columnCount')">
          <USelect :model-value="String(children.length)" :items="[2,3,4,5,6].map(value => ({ label: String(value), value: String(value) }))" @update:model-value="setColumnCount" />
        </UFormField>
        <UCheckbox v-if="blockName === 'columnsBlock'" :model-value="attrs.showHeaders !== false" :label="label('showHeaders')" @update:model-value="updateAttrs({ showHeaders: $event === true })" />
        <template v-if="childType">
          <div v-for="(child, index) in children" :key="index" class="space-y-2 rounded-md border border-[var(--pb-divider)] p-2" :draggable="blockName === 'columnsBlock'" @dragstart="draggedIndex = index" @dragover.prevent @drop.prevent="dropChild(index)" @dragend="draggedIndex = null">
            <UFormField :label="`${label(blockName === 'columnsBlock' ? 'columns' : blockName === 'tabsBlock' ? 'tabs' : 'panes')} ${index + 1}`">
              <UInput :model-value="String(child.attrs?.[childLabelKey] ?? '')" @update:model-value="setChild(index, { [childLabelKey]: String($event) })" />
            </UFormField>
            <UCheckbox v-if="blockName === 'accordionBlock'" :model-value="openIndices.includes(index)" :disabled="attrs.startCollapsed === true" :label="label('openByDefault')" @update:model-value="setPaneOpen(index, $event === true)" />
            <div class="flex gap-1">
              <UButton type="button" icon="i-lucide-arrow-up" size="xs" variant="ghost" :disabled="index === 0" :aria-label="t('admin.editor.toolbar.moveUp')" @click="moveChild(index, -1)" />
              <UButton type="button" icon="i-lucide-arrow-down" size="xs" variant="ghost" :disabled="index === children.length - 1" :aria-label="t('admin.editor.toolbar.moveDown')" @click="moveChild(index, 1)" />
              <UButton type="button" icon="i-lucide-trash" size="xs" color="error" variant="ghost" :disabled="children.length <= minChildren" @click="removeChild(index)">{{ label('remove') }}</UButton>
            </div>
          </div>
          <UButton type="button" size="sm" icon="i-lucide-plus" variant="soft" :disabled="children.length >= maxChildren" @click="addChild">{{ label('add') }}</UButton>
        </template>
        <UFormField v-if="blockName === 'tabsBlock'" :label="label('defaultTab')">
          <USelect :model-value="String(attrs.activeIndex ?? 0)" :items="children.map((child, i) => ({ label: String(child.attrs?.title || `${label('tabs')} ${i + 1}`), value: String(i) }))" @update:model-value="updateAttrs({ activeIndex: Number($event) })" />
        </UFormField>
        <UFormField v-if="footnoteSection" :label="label('title')">
          <UInput :model-value="footnoteSection.node.textContent" @update:model-value="setFootnoteTitle" />
        </UFormField>
        <div v-if="blockName === 'table'" class="grid grid-cols-2 gap-2">
          <UButton v-for="command in tableCommands" :key="command.key" type="button" variant="soft" @click="runTableCommand(command.key)">{{ label(command.label) }}</UButton>
        </div>
      </div>
    </template>
  </div>
</template>
<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import type { JsonContent } from '~/types/content'
import DialogueSettings from './DialogueSettings.vue'
import PostEmbedSettings from './PostEmbedSettings.vue'
import { CODE_BLOCK_LANGUAGES } from '~/extensions/codeBlockEnhanced'
import { DIFF_BLOCK_LANGUAGES, normalizeDiffLanguage } from '~/utils/diffBlock'
import { normalizeBlockPresentation, layoutPreset, imagePreset } from '~/utils/blockPresentation'

const props = defineProps<{ editor: Editor | null }>()
const { t } = useI18n()
const editorStore = useEditorStore()
const registry = useBlockRegistry()
const blockName = computed(() => editorStore.selectedBlockType)
const attrs = computed(() => editorStore.selectedBlockAttrs)
const blockDefinition = computed(() => blockName.value ? registry.getBlockDefinition(blockName.value) : null)
function label(key: string) { return t(`admin.editor.settingsPanel.${key}`) }
const selected = computed(() => {
  void attrs.value
  const ed = props.editor
  if (!ed || !blockName.value) return null
  const candidates = [editorStore.selectedBlockPos]
  const { $from } = ed.state.selection
  for (let depth = $from.depth; depth > 0; depth--) candidates.push($from.before(depth))
  for (const pos of candidates) {
    if (typeof pos !== 'number') continue
    const node = ed.state.doc.nodeAt(pos)
    if (node?.type.name === blockName.value) return { pos, node }
  }
  return null
})
interface Field { key: string, label: string, fallback?: unknown, items?: Array<{ label: string, value: string }>, boolean?: boolean, multiline?: boolean }
function options(keys: string[]) { return keys.map(key => ({ label: label(key), value: key })) }
const imageItems = computed(() => [{ label: label('small'), value: 'small' }, { label: label('medium'), value: 'medium' }, { label: label('fullContentWidth'), value: 'full' }])
const layoutItems = computed(() => [{ label: label('equal'), value: 'equal' }, ...(blockName.value === 'columnsBlock' && children.value.length !== 2 ? [] : [{ label: label('widerLeft'), value: 'wider-left' }, { label: label('widerRight'), value: 'wider-right' }])])
const fields = computed<Field[]>(() => {
  const align = { key: 'align', label: 'alignment', fallback: 'center', items: options(['left', 'center', 'right']) }
  const width = { key: 'blockWidth', label: 'blockWidth', fallback: 'content', items: [{ label: label('content'), value: 'content' }, { label: label('wide'), value: 'wide' }, { label: label('fullBleed'), value: 'full-bleed' }] }
  const titlePosition = options(['none', 'top', 'bottom'])
  switch (blockName.value) {
    case 'heading': return [{ key: 'level', label: 'headingLevel', fallback: 2, items: [1,2,3,4,5,6].map(n => ({ label: `H${n}`, value: String(n) })) }]
    case 'image': return [
      { key: 'src', label: 'sourceUrl' }, { key: 'alt', label: 'altText' }, { key: 'title', label: 'title' },
      { key: 'titlePosition', label: 'titlePosition', fallback: 'bottom', items: titlePosition },
      { key: 'sizePreset', label: 'displaySize', fallback: 'full', items: imageItems.value }, align
    ]
    case 'mediaText': return [
      { key: 'mediaPosition', label: 'mediaPosition', fallback: 'left', items: options(['left', 'right']) },
      { key: 'mediaSrc', label: 'mediaUrl' }, { key: 'mediaAlt', label: 'alt' }, { key: 'mediaTitle', label: 'caption' },
      { key: 'mediaTitlePosition', label: 'captionPosition', fallback: 'bottom', items: titlePosition }, width,
      { key: 'mediaSizePreset', label: 'displaySize', fallback: 'full', items: imageItems.value },
      { key: 'layoutPreset', label: 'layout', fallback: 'equal', items: layoutItems.value }
    ]
    case 'columnsBlock': return [{ key: 'layoutPreset', label: 'layout', fallback: 'equal', items: layoutItems.value }, width]
    case 'filesBlock': return [width]
    case 'codeBlock': return [
      { key: 'fileName', label: 'fileNameOptional' },
      { key: 'language', label: 'language', fallback: 'text', items: CODE_BLOCK_LANGUAGES.map(item => ({ ...item })) },
      { key: 'lineNumbers', label: 'showLineNumbers', fallback: true, boolean: true },
      { key: 'lineHighlights', label: 'highlightedLines' },
      { key: 'showTotalLines', label: 'showTotalLines', fallback: false, boolean: true },
      { key: 'wrap', label: 'wrapLongLines', fallback: true, boolean: true }
    ]
    case 'blockMath': return [align]
    case 'tabsBlock': return [{ key: 'orientation', label: 'orientation', fallback: 'horizontal', items: options(['horizontal', 'vertical']) }, width]
    case 'accordionBlock': return [
      { key: 'singleOpen', label: 'onlyOnePane', fallback: true, boolean: true },
      { key: 'startCollapsed', label: 'startCollapsed', fallback: false, boolean: true },
      { key: 'columns', label: 'columns', fallback: 1, items: [1,2,3].map(n => ({ label: String(n), value: String(n) })) }, width
    ]
    case 'blockquote': return [{ key: 'style', label: 'style', fallback: 'bar', items: [{ label: label('quoteBar'), value: 'bar' }, { label: label('quoteMarks'), value: 'marks' }] }, { key: 'authorName', label: 'authorNameOptional' }, { key: 'authorTitle', label: 'titleRoleOptional' }]
    case 'horizontalRule': return [{ key: 'styleType', label: 'lineStyle', fallback: 'solid', items: options(['solid', 'dashed', 'dotted']) }]
    case 'customHtml': return [{ key: 'html', label: 'customHtml', multiline: true }]
    case 'mermaid': return [{ key: 'code', label: 'mermaid', multiline: true }]
    case 'diffBlock': return [{ key: 'language', label: 'language', fallback: 'plaintext', items: DIFF_BLOCK_LANGUAGES.map(item => ({ label: item.label, value: item.value })) }, { key: 'oldLabel', label: 'oldLabel' }, { key: 'newLabel', label: 'newLabel' }]
    case 'annotationBlock': return [{ key: 'lang', label: 'defaultLanguage', fallback: 'cmn', items: [{ label: 'Mandarin', value: 'cmn' }, { label: 'Cantonese', value: 'yue' }, { label: 'Japanese', value: 'jpn' }] }]
    case 'footnotesBlock': return [{ key: 'title', label: 'title' }]
    default: return []
  }
})
function setField(field: Field, value: unknown) {
  const raw = value && typeof value === 'object' && 'value' in value ? (value as { value: unknown }).value : value
  let next: unknown = field.boolean ? raw === true : String(raw ?? '')
  if (field.key === 'level' || field.key === 'columns') next = Number(next)
  if (field.key === 'language' && blockName.value === 'diffBlock') next = normalizeDiffLanguage(next)
  if (field.key === 'sizePreset' || field.key === 'mediaSizePreset') next = imagePreset(next)
  if (field.key === 'layoutPreset') next = layoutPreset(next, blockName.value === 'columnsBlock' ? children.value.length : 2)
  if (field.key === 'mediaAlt') {
    const items = Array.isArray(attrs.value.mediaItems) ? attrs.value.mediaItems : []
    updateAttrs({ mediaAlt: next, mediaItems: items.map((item, i) => i === 0 ? { ...item as Record<string, unknown>, alt: next } : item) })
    return
  }
  updateAttrs({ [field.key]: next })
}
function updateAttrs(next: Record<string, unknown>) {
  const ed = props.editor, target = selected.value
  if (!ed || !target || !ed.isEditable) return
  const merged = { ...target.node.attrs, ...next }
  if ('src' in next || 'mediaSrc' in next) {
    merged.imageSources = null
    if ('src' in next) { merged.naturalWidth = null; merged.naturalHeight = null }
    if ('mediaSrc' in next) { merged.mediaNaturalWidth = null; merged.mediaNaturalHeight = null; merged.mediaItems = [] }
  }
  if (blockName.value === 'accordionBlock') { replaceChildren(children.value, merged); return }
  const normalized = normalizeBlockPresentation({ type: blockName.value!, attrs: merged }).attrs!
  ed.view.dispatch(ed.state.tr.setNodeMarkup(target.pos, undefined, normalized))
  editorStore.mergeSelectedBlockAttrs(normalized)
}
const childType = computed(() => blockName.value === 'columnsBlock' ? 'columnItem' : blockName.value === 'tabsBlock' ? 'tabPanel' : blockName.value === 'accordionBlock' ? 'accordionPane' : null)
const childLabelKey = computed(() => blockName.value === 'columnsBlock' ? 'header' : 'title')
const children = computed<JsonContent[]>(() => childType.value ? (selected.value?.node.toJSON().content ?? []).filter((child: JsonContent) => child.type === childType.value) : [])
const minChildren = computed(() => blockName.value === 'accordionBlock' ? 1 : 2)
const maxChildren = computed(() => blockName.value === 'accordionBlock' ? 12 : 6)
const openIndices = computed<number[]>(() => attrs.value.startCollapsed === true ? [] : Array.isArray(attrs.value.defaultOpenIndices) ? attrs.value.defaultOpenIndices as number[] : children.value.flatMap((child, i) => child.attrs?.defaultOpen ? [i] : []))
function replaceChildren(content: JsonContent[], nextAttrs = attrs.value) {
  const ed = props.editor, target = selected.value
  if (!ed || !target || !ed.isEditable) return
  const attributes = { ...nextAttrs }
  if (blockName.value === 'columnsBlock') { attributes.columns = content.length; attributes.layoutPreset = layoutPreset(attributes.layoutPreset, content.length) }
  if (blockName.value === 'tabsBlock') attributes.activeIndex = Math.max(0, Math.min(content.length - 1, Number(attributes.activeIndex) || 0))
  if (blockName.value === 'accordionBlock') {
    let open = Array.isArray(attributes.defaultOpenIndices) ? attributes.defaultOpenIndices.filter(i => Number.isInteger(i) && Number(i) >= 0 && Number(i) < content.length) as number[] : []
    if (attributes.startCollapsed === true) open = []
    else if (attributes.singleOpen !== false) open = open.slice(0, 1)
    attributes.defaultOpenIndices = open
    content = content.map((child, i) => ({ ...child, attrs: { ...child.attrs, defaultOpen: open.includes(i) } }))
  }
  const json = normalizeBlockPresentation({ type: blockName.value!, attrs: attributes, content })
  const replacement = ed.schema.nodeFromJSON(json)
  ed.view.dispatch(ed.state.tr.replaceWith(target.pos, target.pos + target.node.nodeSize, replacement))
  editorStore.selectBlock({ id: `${blockName.value}:${target.pos}`, type: blockName.value!, attrs: json.attrs!, pos: target.pos })
}
function setChild(index: number, next: Record<string, unknown>) {
  const content = children.value.map((child, i) => i === index ? { ...child, attrs: { ...child.attrs, ...next } } : child)
  replaceChildren(content)
}
function setColumnCount(value: unknown) {
  const count = Math.max(2, Math.min(6, Number(value) || 2)), content = [...children.value]
  if (content.length > count) {
    const overflow = content.splice(count)
    const last = content[count - 1]!
    content[count - 1] = { ...last, content: [...(last.content ?? []), ...overflow.flatMap(child => child.content ?? [])] }
  }
  while (content.length < count) content.push(newChild())
  replaceChildren(content)
}
function newChild(): JsonContent { return { type: childType.value!, attrs: { [childLabelKey.value]: '', ...(blockName.value === 'accordionBlock' ? { defaultOpen: false } : {}) }, content: [{ type: 'paragraph' }] } }
function addChild() { if (children.value.length < maxChildren.value) replaceChildren([...children.value, newChild()]) }
function removeChild(index: number) {
  if (children.value.length <= minChildren.value) return
  const content = [...children.value], [removed] = content.splice(index, 1)
  // Preserve removed container content in its neighbour, as the original editor did.
  if (removed?.content) {
    const receiver = Math.max(0, index - 1), child = content[receiver]!
    content[receiver] = { ...child, content: [...(child.content ?? []), ...removed.content] }
  }
  const next = { ...attrs.value }
  if (blockName.value === 'accordionBlock') next.defaultOpenIndices = openIndices.value.filter(i => i !== index).map(i => i > index ? i - 1 : i)
  if (blockName.value === 'tabsBlock') {
    const active = Number(next.activeIndex) || 0
    next.activeIndex = active > index ? active - 1 : active === index ? Math.max(0, index - 1) : active
  }
  replaceChildren(content, next)
}
function moveChild(index: number, direction: number) {
  const destination = index + direction
  if (destination < 0 || destination >= children.value.length) return
  const content = [...children.value], [child] = content.splice(index, 1)
  content.splice(destination, 0, child!)
  const next = { ...attrs.value }
  if (blockName.value === 'accordionBlock') next.defaultOpenIndices = content.flatMap((pane, i) => pane.attrs?.defaultOpen ? [i] : [])
  if (blockName.value === 'tabsBlock') {
    const active = Number(next.activeIndex) || 0
    next.activeIndex = active === index ? destination : active === destination ? index : active
  }
  replaceChildren(content, next)
}
const draggedIndex = ref<number | null>(null)
function dropChild(index: number) {
  const from = draggedIndex.value
  draggedIndex.value = null
  if (from === null || from === index) return
  const content = [...children.value], [child] = content.splice(from, 1)
  content.splice(index, 0, child!)
  replaceChildren(content)
}
function setPaneOpen(index: number, open: boolean) {
  const indices = attrs.value.singleOpen !== false ? (open ? [index] : []) : [...openIndices.value.filter(i => i !== index), ...(open ? [index] : [])].sort((a,b) => a-b)
  replaceChildren(children.value, { ...attrs.value, defaultOpenIndices: indices })
}
const tableCommands = [{ key: 'addColumnAfter', label: 'addColumn' }, { key: 'addRowAfter', label: 'addRow' }, { key: 'deleteColumn', label: 'deleteColumn' }, { key: 'deleteRow', label: 'deleteRow' }] as const
function runTableCommand(command: typeof tableCommands[number]['key']) { props.editor?.chain().focus()[command]().run() }
const footnoteSection = computed(() => {
  void attrs.value
  const ed = props.editor
  if (!ed) return null
  const nodes: Array<{ pos: number, node: import('@tiptap/pm/model').Node }> = []
  ed.state.doc.forEach((node, pos) => nodes.push({ node, pos }))
  for (let i = 1; i < nodes.length; i++) {
    const heading = nodes[i - 1]!, list = nodes[i]!
    if (heading.node.type.name === 'paragraph' && list.node.type.name === 'orderedList'
      && [heading.pos, list.pos].includes(editorStore.selectedBlockPos ?? -1)) return heading
  }
  return null
})
function setFootnoteTitle(value: unknown) {
  const ed = props.editor, section = footnoteSection.value
  if (!ed || !section) return
  ed.view.dispatch(ed.state.tr.insertText(String(value ?? '').trim() || label('footnotes'), section.pos + 1, section.pos + section.node.nodeSize - 1))
}
</script>
