import type { JsonContent } from '~/types/content'
import { normalizeDocForSave } from '~/utils/emptyBlocks'

/**
 * Whether a post's editor state contains anything worth persisting. Blank
 * titles, whitespace-only documents, and empty blocks all count as empty.
 */
export function hasMeaningfulPostContent(title: string | null | undefined, content: JsonContent | null | undefined): boolean {
  return Boolean(title?.trim()) || hasMeaningfulDocContent(content)
}

export function hasMeaningfulDocContent(content: JsonContent | null | undefined): boolean {
  const normalized = normalizeDocForSave(content)
  if (!normalized) {
    return false
  }

  if (normalized.text?.trim()) {
    return true
  }

  return Array.isArray(normalized.content) && normalized.content.length > 0
}
