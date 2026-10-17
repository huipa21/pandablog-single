import type { JsonContent } from '~/types/content'

export function normalizeFootnotesDoc(doc: JsonContent): { doc: JsonContent, changed: boolean } {
  const draft = JSON.parse(JSON.stringify(doc)) as JsonContent
  const rootChildren = Array.isArray(draft.content) ? draft.content : []
  let changed = false

  if (rootChildren.length >= 2) {
    for (let i = rootChildren.length - 1; i >= 1; i -= 1) {
      const orderedList = rootChildren[i]
      const heading = rootChildren[i - 1]
      if (!heading || !orderedList) continue
      if (heading.type !== 'paragraph' || orderedList.type !== 'orderedList') continue
      if (flattenFootnoteNodeText(heading).trim().toLowerCase() !== 'footnotes') continue

      const block: JsonContent = {
        type: 'footnotesBlock',
        content: [orderedList]
      }
      rootChildren.splice(i - 1, 2, block)
      changed = true
      break
    }
  }

  const footnotesPosition = moveFootnotesBlockToBottom(rootChildren, rootChildren.findIndex((node) => node.type === 'footnotesBlock'))
  let footnotesBlockIndex = footnotesPosition.index
  if (footnotesPosition.changed) {
    changed = true
  }
  let refs = collectFootnoteRefs(rootChildren, footnotesBlockIndex)
  let refOrder = refs.order

  if (footnotesBlockIndex < 0) {
    if (!refOrder.length) {
      return { doc: draft, changed }
    }

    rootChildren.push({
      type: 'footnotesBlock',
      content: [{
        type: 'orderedList',
        content: refOrder.map((id) => ({
          type: 'listItem',
          attrs: { footnoteId: id },
          content: [{ type: 'paragraph', content: [] }]
        }))
      }]
    })
    footnotesBlockIndex = rootChildren.length - 1
    changed = true
  }

  const footnotesBlock = rootChildren[footnotesBlockIndex]
  if (!footnotesBlock) {
    return { doc: draft, changed }
  }
  if (!footnotesBlock.content || !footnotesBlock.content.length || footnotesBlock.content[0]?.type !== 'orderedList') {
    footnotesBlock.content = [{ type: 'orderedList', content: [] }]
    changed = true
  }

  const orderedList = footnotesBlock.content?.[0]
  const listItems = Array.isArray(orderedList?.content) ? orderedList!.content! : []

  const footnoteItemNormalization = extractStandaloneBlocksFromFootnoteItems(listItems)
  if (footnoteItemNormalization.changed) {
    if (footnoteItemNormalization.escapedBlocks.length) {
      rootChildren.splice(footnotesBlockIndex, 0, ...footnoteItemNormalization.escapedBlocks)
      footnotesBlockIndex += footnoteItemNormalization.escapedBlocks.length
    }
    refs = collectFootnoteRefs(rootChildren, footnotesBlockIndex)
    refOrder = refs.order
    changed = true
  }

  const existingIds = refs.order
  for (let i = 0; i < listItems.length; i += 1) {
    const item = listItems[i]
    if (!item || item.type !== 'listItem') continue
    const attrs = (item.attrs && typeof item.attrs === 'object') ? item.attrs as Record<string, unknown> : {}
    const existingId = typeof attrs.footnoteId === 'string' ? attrs.footnoteId.trim() : ''
    if (!existingId) {
      const fallbackId = existingIds[i]
      if (fallbackId) {
        item.attrs = { ...attrs, footnoteId: fallbackId }
        changed = true
      }
    }
  }

  const itemById = new Map<string, JsonContent>()
  const itemIds: string[] = []
  for (const item of listItems) {
    if (!item || item.type !== 'listItem') continue
    const id = String(item.attrs?.footnoteId ?? '').trim()
    if (!id || itemById.has(id)) continue
    itemById.set(id, item)
    itemIds.push(id)
  }

  const itemSet = new Set(itemIds)
  const keepIds = refOrder.filter((id) => itemSet.has(id))

  for (const refNode of refs.nodes) {
    const mark = refNode.marks?.find((entry) => entry.type === 'footnote')
    const id = String(mark?.attrs?.id ?? '').trim()
    if (!id || keepIds.includes(id)) {
      continue
    }

    refNode.text = ''
    changed = true
  }
  pruneEmptyTextNodes(rootChildren)

  const nextItems = keepIds.map((id) => {
    const existing = itemById.get(id)
    if (existing) {
      const attrs = (existing.attrs && typeof existing.attrs === 'object') ? existing.attrs as Record<string, unknown> : {}
      const currentText = flattenFootnoteNodeText(existing).trim()
      if (/^footnote\s+\d+$/i.test(currentText)) {
        existing.content = [{ type: 'paragraph', content: [] }]
      }
      existing.attrs = { ...attrs, footnoteId: id }
      return existing
    }

    return {
      type: 'listItem',
      attrs: { footnoteId: id },
      content: [{ type: 'paragraph', content: [] }]
    } as JsonContent
  })

  if (JSON.stringify(nextItems) !== JSON.stringify(listItems)) {
    orderedList!.content = nextItems
    changed = true
  }

  const newIndexById = new Map<string, number>()
  keepIds.forEach((id, index) => {
    newIndexById.set(id, index + 1)
  })

  for (const refNode of refs.nodes) {
    if (!refNode.marks) continue

    const nextMarks = refNode.marks.map((mark) => {
      if (mark.type !== 'footnote') return mark
      const id = String(mark.attrs?.id ?? '').trim()
      const nextIndex = newIndexById.get(id)
      if (!id || !nextIndex) {
        changed = true
        return null
      }

      const nextAttrs = { ...(mark.attrs ?? {}), id, index: nextIndex }
      if ((mark.attrs?.index ?? null) !== nextIndex) {
        changed = true
      }

      if (refNode.text !== String(nextIndex)) {
        refNode.text = String(nextIndex)
        changed = true
      }

      return { ...mark, attrs: nextAttrs }
    }).filter(Boolean) as Array<{ type: string, attrs?: Record<string, unknown> }>

    if (nextMarks.length !== refNode.marks.length) {
      changed = true
    }

    refNode.marks = nextMarks
  }
  pruneEmptyTextNodes(rootChildren)

  if (!keepIds.length) {
    rootChildren.splice(footnotesBlockIndex, 1)
    changed = true
  }

  draft.content = rootChildren
  return { doc: draft, changed }
}

function collectFootnoteRefs(children: JsonContent[], footnotesBlockIndex: number) {
  const order: string[] = []
  const seen = new Set<string>()
  const nodes: Array<JsonContent & { marks?: Array<{ type: string, attrs?: Record<string, unknown> }> }> = []

  const walk = (node: JsonContent) => {
    if (node.type === 'text') {
      const marks = Array.isArray(node.marks) ? node.marks : []
      for (const mark of marks) {
        if (mark.type !== 'footnote') continue
        const id = String(mark.attrs?.id ?? '').trim()
        if (!id) continue
        nodes.push(node as JsonContent & { marks?: Array<{ type: string, attrs?: Record<string, unknown> }> })
        if (!seen.has(id)) {
          seen.add(id)
          order.push(id)
        }
      }
    }

    if (!Array.isArray(node.content)) {
      return
    }
    for (const child of node.content) {
      walk(child)
    }
  }

  children.forEach((node, index) => {
    if (index === footnotesBlockIndex) {
      return
    }
    walk(node)
  })

  return { order, nodes }
}

function moveFootnotesBlockToBottom(children: JsonContent[], footnotesBlockIndex: number) {
  if (footnotesBlockIndex < 0) {
    return { index: footnotesBlockIndex, changed: false }
  }

  const [footnotesBlock] = children.splice(footnotesBlockIndex, 1)
  if (!footnotesBlock) {
    return { index: -1, changed: true }
  }

  const targetIndex = children.length
  children.splice(targetIndex, 0, footnotesBlock)
  return { index: targetIndex, changed: targetIndex !== footnotesBlockIndex }
}

function extractStandaloneBlocksFromFootnoteItems(listItems: JsonContent[]) {
  const escapedBlocks: JsonContent[] = []
  let changed = false

  for (const item of listItems) {
    if (!item || item.type !== 'listItem') continue

    const children = Array.isArray(item.content) ? item.content : []
    let keptParagraph: JsonContent | null = null
    const nextContent: JsonContent[] = []

    for (const child of children) {
      if (child.type === 'paragraph' && !keptParagraph) {
        keptParagraph = child
        nextContent.push(child)
        continue
      }

      escapedBlocks.push(child.type === 'text' ? { type: 'paragraph', content: [child] } : child)
    }

    if (!keptParagraph) {
      nextContent.push({ type: 'paragraph', content: [] })
    }

    if (JSON.stringify(item.content ?? []) !== JSON.stringify(nextContent)) {
      item.content = nextContent
      changed = true
    }
  }

  return { escapedBlocks, changed }
}

function flattenFootnoteNodeText(node: JsonContent): string {
  if (node.type === 'text') {
    return node.text ?? ''
  }

  if (!Array.isArray(node.content)) {
    return ''
  }

  return node.content.map(flattenFootnoteNodeText).join(' ')
}

function pruneEmptyTextNodes(nodes: JsonContent[]) {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i]
    if (!node) {
      continue
    }

    if (Array.isArray(node.content)) {
      pruneEmptyTextNodes(node.content)
    }

    if (node.type === 'text' && !node.text) {
      nodes.splice(i, 1)
      continue
    }
  }
}
