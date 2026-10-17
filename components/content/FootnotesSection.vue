<template>
  <footer v-if="footnotes.length > 0 && !hasExplicitFootnotesBlock" class="footnotes mt-12 pt-4">
    <div class="mb-3 h-px w-3/5 bg-[var(--pb-divider-strong)]" />
    <ol class="footnotes-list text-sm text-[var(--pb-text-muted)]">
      <li v-for="fn in footnotes" :id="`fn-${fn.id}`" :key="fn.id" class="footnotes-list-item" :data-footnote-id="fn.id">
        <a class="footnote-backref" :href="`#fnref-${fn.id}`" :aria-label="`Back to footnote reference ${fn.index}`">{{ fn.index }}</a>
        <span>{{ fn.content }}</span>
      </li>
    </ol>
  </footer>
</template>

<script setup lang="ts">
import type { JsonContent } from '~/types/content'
import { flattenContentText } from '~/utils/contentText'

const props = defineProps<{
  content: JsonContent
}>()

interface FootnoteEntry {
  id: string
  index: number
  content: string
}

const footnotes = computed(() => {
  const refs = collectFootnoteRefs(props.content)
  const notes = extractFootnoteNotes(props.content)

  return refs.map((ref, idx) => ({
    ...ref,
    content: notes[idx] ?? ''
  }))
})

const hasExplicitFootnotesBlock = computed(() => Boolean(props.content.content?.some((node) => node.type === 'footnotesBlock')))

function collectFootnoteRefs(node: JsonContent) {
  const refs: FootnoteEntry[] = []
  const seen = new Set<string>()

  walkContent(node, (mark) => {
    const id = String(mark.attrs?.id ?? '')
    if (!id || seen.has(id)) return

    seen.add(id)
    refs.push({
      id,
      index: Number(mark.attrs?.index ?? refs.length + 1),
      content: ''
    })
  })

  refs.sort((a, b) => a.index - b.index)
  return refs
}

function walkContent(node: JsonContent, onFootnote: (mark: { type: string, attrs?: Record<string, unknown> }) => void) {
  if (node.marks) {
    for (const mark of node.marks) {
      if (mark.type === 'footnote') {
        onFootnote(mark)
      }
    }
  }
  if (node.content) {
    for (const child of node.content) {
      walkContent(child, onFootnote)
    }
  }
}

function extractFootnoteNotes(doc: JsonContent) {
  const children = doc.content ?? []

  for (const child of children) {
    if (child.type !== 'footnotesBlock') {
      continue
    }

    const orderedList = child.content?.find((node) => node.type === 'orderedList')
    if (!orderedList) {
      return []
    }

    return (orderedList.content ?? []).map((item) => flattenContentText(item).trim())
  }

  if (children.length < 2) return []

  for (let i = children.length - 1; i >= 1; i -= 1) {
    const orderedList = children[i]
    const heading = children[i - 1]
    if (!heading || !orderedList) continue
    if (heading.type !== 'paragraph' || orderedList.type !== 'orderedList') continue
    if (flattenContentText(heading).trim().toLowerCase() !== 'footnotes') continue
    return (orderedList.content ?? []).map((item) => flattenContentText(item).trim())
  }

  return []
}

</script>
