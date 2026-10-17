import type { JsonContent } from '~/types/content'
import { flattenContentText } from '~/utils/contentText'

export interface TocItem {
  id: string
  text: string
  level: number
}

export function useTableOfContents(content: Ref<JsonContent | null | undefined> | ComputedRef<JsonContent | null | undefined>) {
  const activeId = ref('')
  let observer: IntersectionObserver | null = null

  const items = computed(() => extractTableOfContents(content.value))

  function observeHeadings() {
    observer?.disconnect()
    observer = null

    if (!import.meta.client || !items.value.length) {
      return
    }

    observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]

      if (visible?.target.id) {
        activeId.value = visible.target.id
      }
    }, {
      rootMargin: '-96px 0px -70% 0px',
      threshold: [0, 1]
    })

    for (const item of items.value) {
      const heading = document.getElementById(item.id)
      if (heading) {
        observer.observe(heading)
      }
    }

    if (!activeId.value && items.value[0]) {
      activeId.value = items.value[0].id
    }
  }

  onMounted(() => {
    void nextTick(observeHeadings)
  })

  watch(items, () => {
    void nextTick(observeHeadings)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
  })

  return { items, activeId }
}

export function extractTableOfContents(content: JsonContent | null | undefined): TocItem[] {
  const items: TocItem[] = []

  function visit(node: JsonContent | null | undefined) {
    if (!node) {
      return
    }

    if (node.type === 'heading') {
      const text = flattenContentText(node).trim()
      if (text) {
        items.push({
          id: slugifyHeading(text),
          text,
          level: cleanLevel(node.attrs?.level)
        })
      }
    }

    for (const child of node.content ?? []) {
      visit(child)
    }
  }

  visit(content)
  return items
}

function cleanLevel(value: unknown) {
  const level = Number(value)
  return [1, 2, 3].includes(level) ? level : 2
}
