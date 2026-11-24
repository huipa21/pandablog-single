import { randomUUID } from 'node:crypto'
import { createError } from 'h3'
import type { Surreal } from 'surrealdb'
import type { JsonContent } from '~/types/content'
import type { WordRecord, WordSense } from '~/types/word'
import {
  normalizeMultilineWordText,
  parseSenseIdsAttribute,
  normalizeWordLanguage,
  normalizeWordSenses,
  normalizeWordText
} from '../../utils/words'
import { queryDb } from './db'
import { queryRows, recordIdPart, stringifyRecordId } from './surrealResult'
import { serializeDate } from './content'

const MAX_WORD_IDS = 300

export interface WordPayload {
  headword: string
  headword_key: string
  language: string
  pronunciation: string | null
  senses: WordSense[]
  archived: boolean
}

export function wordHeadwordKey(headword: string): string {
  return headword.normalize('NFKC').toLowerCase()
}

function ensureSenseIds(senses: WordSense[]): WordSense[] {
  const seen = new Set<string>()
  return senses.map((sense) => {
    const id = sense.id && !seen.has(sense.id) ? sense.id : randomUUID().replace(/-/g, '')
    seen.add(id)
    return { ...sense, id }
  })
}

/** Validate and canonicalise a create/update payload from the admin API. */
export function buildWordPayload(input: Record<string, unknown>, existing?: WordRecord | null): WordPayload {
  const headword = normalizeWordText(input.headword, 200)
  if (!headword) {
    throw createError({ statusCode: 400, message: 'A headword is required.' })
  }

  const senses = ensureSenseIds(normalizeWordSenses(input.senses))
  if (!senses.length) {
    throw createError({ statusCode: 400, message: 'At least one sense with a definition is required.' })
  }

  return {
    headword,
    headword_key: wordHeadwordKey(headword),
    language: normalizeWordLanguage(input.language ?? existing?.language),
    pronunciation: normalizeMultilineWordText(input.pronunciation, 400) || null,
    senses,
    archived: typeof input.archived === 'boolean' ? input.archived : existing?.archived === true
  }
}

/** Normalise a raw SurrealDB `word` row into the client-facing shape. */
export function normalizeWordRecord(record: Record<string, unknown>): WordRecord {
  const senses = ensureSenseIds(normalizeWordSenses(record.senses))
  return {
    id: stringifyRecordId(record.id),
    headword: String(record.headword ?? '').trim(),
    language: normalizeWordLanguage(record.language),
    pronunciation: record.pronunciation === undefined || record.pronunciation === null
      ? null
      : String(record.pronunciation),
    senses,
    archived: record.archived === true,
    created_at: serializeDate(record.created_at),
    updated_at: serializeDate(record.updated_at)
  }
}

export async function assertUniqueWord(db: Surreal, payload: WordPayload, currentId = ''): Promise<void> {
  const current = recordIdPart(currentId, 'word')
  const response = await queryDb(
    db,
    `SELECT id FROM word
     WHERE language = $language AND headword_key = $key
     LIMIT 2;`,
    { language: payload.language, key: payload.headword_key },
    { label: 'word uniqueness check' }
  )

  const conflict = queryRows<{ id: unknown }>(response)
    .map(row => stringifyRecordId(row.id))
    .find(id => id && id !== currentId && recordIdPart(id, 'word') !== current)

  if (conflict) {
    throw createError({
      statusCode: 409,
      message: `"${payload.headword}" already exists in this language.`
    })
  }
}

/**
 * Batch-resolve word-card anchors. Archived words are included for the admin
 * editor (so existing cards remain editable) but excluded from public output.
 */
export async function fetchWordRecords(
  db: Surreal,
  ids: string[],
  options: { includeArchived?: boolean } = {}
): Promise<Map<string, WordRecord>> {
  const unique = [...new Set(
    ids.map(id => recordIdPart(id, 'word')).filter(Boolean)
  )].slice(0, MAX_WORD_IDS)
  const found = new Map<string, WordRecord>()
  if (!unique.length) {
    return found
  }

  const placeholders = unique.map((_, index) => `type::record('word', $w${index})`)
  const params: Record<string, unknown> = {}
  unique.forEach((id, index) => {
    params[`w${index}`] = id
  })
  const archivedFilter = options.includeArchived ? '' : 'AND archived = false'

  const response = await queryDb(
    db,
    `SELECT * FROM word
     WHERE id IN [${placeholders.join(', ')}] ${archivedFilter};`,
    params,
    { label: 'word card resolve' }
  )

  for (const row of queryRows<Record<string, unknown>>(response)) {
    const word = normalizeWordRecord(row)
    if (word.id) {
      found.set(word.id, word)
    }
  }

  return found
}

export function collectWordCardIds(node: unknown, into: Set<string> = new Set()): Set<string> {
  const value = node as { type?: string, attrs?: Record<string, unknown>, content?: unknown[] } | null | undefined
  if (!value || typeof value !== 'object') {
    return into
  }

  if (value.type === 'wordCard') {
    const id = String(value.attrs?.wordId ?? '').trim()
    if (id) into.add(id)
    return into
  }

  if (Array.isArray(value.content)) {
    value.content.forEach(child => collectWordCardIds(child, into))
  }

  return into
}

/**
 * Attach the live word record to each `wordCard` node as `attrs.resolved`.
 * The stored node only carries the anchor and selected sense ids, so this is
 * the single place where post content meets lexicon content.
 */
export async function resolveWordCardsInDoc(
  db: Surreal,
  doc: JsonContent,
  options: { includeArchived?: boolean } = {}
): Promise<JsonContent> {
  const ids = collectWordCardIds(doc)
  if (!ids.size) {
    return doc
  }

  const words = await fetchWordRecords(db, [...ids], options)
  const walk = (node: unknown): unknown => {
    const value = node as { type?: string, attrs?: Record<string, unknown>, content?: unknown[] } | null | undefined
    if (!value || typeof value !== 'object') {
      return value
    }

    if (value.type === 'wordCard') {
      const wordId = String(value.attrs?.wordId ?? '').trim()
      return {
        ...value,
        attrs: {
          ...value.attrs,
          senseIds: parseSenseIdsAttribute(value.attrs?.senseIds),
          targetLanguage: String(value.attrs?.targetLanguage ?? ''),
          resolved: wordId ? words.get(wordId) ?? null : null
        }
      }
    }

    if (Array.isArray(value.content)) {
      return { ...value, content: value.content.map(walk) }
    }

    return value
  }

  return walk(doc) as JsonContent
}

