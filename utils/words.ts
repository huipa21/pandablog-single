import type { WordRecord, WordSense } from '~/types/word'

export const WORD_LANGUAGES = [
  { label: 'English', value: 'en' }
] as const

export const WORD_TARGET_LANGUAGES = [
  { label: 'Chinese (Simplified)', value: 'zh-CN' }
] as const

export const DEFAULT_PART_OF_SPEECH = 'noun'
export const DEFAULT_TARGET_LANGUAGE = 'zh-CN'

const SENSE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/

export function normalizeWordLanguage(value: unknown): string {
  const language = String(value ?? '').trim()
  return LANGUAGE_PATTERN.test(language) ? language : 'en'
}

export function normalizeTargetLanguage(value: unknown): string {
  const language = String(value ?? '').trim()
  return LANGUAGE_PATTERN.test(language) ? language : ''
}

export function normalizeWordText(value: unknown, maxLength = 2000): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

export function normalizeMultilineWordText(value: unknown, maxLength = 4000): string {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim().slice(0, maxLength)
}

export function normalizeSenseId(value: unknown): string {
  const id = String(value ?? '').trim()
  return SENSE_ID_PATTERN.test(id) ? id : ''
}

export function normalizeSenseIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()
  const ids: string[] = []
  for (const item of value) {
    const id = normalizeSenseId(item)
    if (id && !seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

export function normalizeTranslations(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const translations: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const language = normalizeTargetLanguage(key)
    const text = normalizeMultilineWordText(raw)
    if (language && text) {
      translations[language] = text
    }
  }
  return translations
}

export function normalizePartOfSpeech(value: unknown): string {
  return normalizeWordText(value, 60) || DEFAULT_PART_OF_SPEECH
}

export function normalizeWordSense(value: unknown): WordSense | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const definition = normalizeMultilineWordText(record.definition)
  if (!definition) {
    return null
  }

  return {
    id: normalizeSenseId(record.id),
    partOfSpeech: normalizePartOfSpeech(record.partOfSpeech ?? record.part_of_speech),
    definition,
    example: normalizeMultilineWordText(record.example) || null,
    note: normalizeMultilineWordText(record.note) || null,
    translations: normalizeTranslations(record.translations)
  }
}

export function normalizeWordSenses(value: unknown): WordSense[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map(normalizeWordSense)
    .filter((sense): sense is WordSense => Boolean(sense))
    .slice(0, 40)
}

export function selectWordSenses(word: Pick<WordRecord, 'senses'> | null | undefined, senseIds: unknown): WordSense[] {
  const all = Array.isArray(word?.senses) ? word.senses : []
  const ids = parseSenseIdsAttribute(senseIds)
  if (!ids.length) {
    return all
  }

  const selected = new Set(ids)
  return all.filter(sense => selected.has(sense.id))
}

export function hasSenseSelection(senseIds: unknown): boolean {
  return normalizeSenseIds(senseIds).length > 0
}

export function groupSensesByPartOfSpeech(senses: WordSense[]): Array<{ partOfSpeech: string, senses: WordSense[] }> {
  const groups = new Map<string, WordSense[]>()
  for (const sense of senses) {
    const partOfSpeech = normalizePartOfSpeech(sense.partOfSpeech)
    const group = groups.get(partOfSpeech) ?? []
    group.push(sense)
    groups.set(partOfSpeech, group)
  }

  return [...groups.entries()].map(([partOfSpeech, groupSenses]) => ({
    partOfSpeech,
    senses: groupSenses
  }))
}

export function senseTranslation(sense: Pick<WordSense, 'translations'>, targetLanguage: unknown): string {
  const language = normalizeTargetLanguage(targetLanguage)
  if (!language) {
    return ''
  }
  return String(sense.translations?.[language] ?? '').trim()
}

export function hasSenseTranslations(word: Pick<WordRecord, 'senses'> | null | undefined, targetLanguage: unknown): boolean {
  const language = normalizeTargetLanguage(targetLanguage)
  if (!language) {
    return false
  }

  return Boolean(word?.senses?.some(sense => senseTranslation(sense, language)))
}

export function parseSenseIdsAttribute(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeSenseIds(value)
  }

  if (typeof value !== 'string' || !value.trim()) {
    return []
  }

  try {
    return normalizeSenseIds(JSON.parse(value))
  } catch {
    return []
  }
}
