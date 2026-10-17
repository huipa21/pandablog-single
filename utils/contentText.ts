import type { JsonContent } from '~/types/content'

export function flattenContentText(node: JsonContent): string {
  if (node.type === 'text') {
    return node.text ?? ''
  }

  return node.content?.map(flattenContentText).join(' ') ?? ''
}
