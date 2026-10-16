import type { Surreal } from 'surrealdb'
import { createError } from 'h3'
import { queryDb, queryDbRecord } from './db'
import { queryRows, recordIdPart } from './surrealResult'
import type { MediaSearchOptions } from './mediaLibrary'
import { buildFuzzyVariants, clampFtsNeedle, extractVocabularyWords, findFuzzyCandidates, fuzzyLookupWords, type FuzzyCandidate } from './fuzzy'

export function mediaScope(user: MediaSearchOptions['visibleToUser'], _manageable = false, readyOnly = true) {
  const policy = user ? "visibility IN ['public', 'private']" : "visibility = 'public'"
  return {where: `(${policy})${readyOnly ? " AND (storage_state = NONE OR storage_state = 'ready')" : ''}`, params: {} as Record<string, unknown>}
}
function bad(message: string): never { throw createError({statusCode: 400, message}) }
export function mediaInteger(value: unknown, fallback: number, min: number, max: number) {
  const number = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(number) || number < min || number > max) bad('Invalid media numeric filter')
  return number
}
function text(value: unknown, max = 500) {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.length > max) bad('Invalid media text filter')
  return value.trim()
}
/** Regex is executed only by SurrealDB's Rust regex engine, never V8. Unsupported
 * backreferences/lookaround are explicit 400s rather than ignored filters. */
export function mediaRegex(value: string, insensitive: boolean) {
  if (value.length > 200 || /\\[1-9]|\(\?[=!<]/.test(value)) bad('Unsupported media regex syntax')
  // Bounded syntax compilation only; no request pattern is ever executed by V8.
  try {new RegExp(value)} catch {bad('Invalid media regex syntax')}
  return `${insensitive ? '(?i)' : ''}${value}`
}
const sorts: Record<string, string> = {uploaded_at_desc: 'uploaded_at DESC, id ASC', uploaded_at_asc: 'uploaded_at ASC, id ASC', name_asc: 'original_name ASC, id ASC', name_desc: 'original_name DESC, id ASC', size_asc: 'size ASC, id ASC', size_desc: 'size DESC, id ASC'}
export async function mediaFileQuery(db: Surreal, options: MediaSearchOptions) {
  const page = mediaInteger(options.page, 1, 1, 10_001), limit = mediaInteger(options.limit, 24, 1, 100), offset = (page - 1) * limit
  if (offset > 10_000) bad('Media page offset exceeds supported limit')
  const sort = options.sort || 'uploaded_at_desc'
  if (!sorts[sort]) bad('Invalid media sort')
  const scope = mediaScope(options.visibleToUser), conditions = [scope.where]
  const params: Record<string, unknown> = {...scope.params, limit, offset}
  let parameter = 0
  const bind = (value: unknown) => {const key = `filter_${parameter++}`; params[key] = value; return `$${key}`}
  const insensitive = options.case_insensitive !== false, regex = options.search_regex === true
  const contains = (column: string, query: string, useRegex = regex, caseInsensitive = insensitive) => {
    const parameter = bind(useRegex ? mediaRegex(query, caseInsensitive) : caseInsensitive ? query.toLowerCase() : query)
    return useRegex ? `string::matches(${column} ?? '', ${parameter})` : `string::contains(${caseInsensitive ? `string::lowercase(${column} ?? '')` : `(${column} ?? '')`}, ${parameter})`
  }
  for (const [column, value] of [['original_name', options.file_name], ['extension', options.extension?.replace(/^\./, '')], ['comment', options.comment]] as const) {
    const query = text(value)
    if (query) conditions.push(contains(column, query))
  }
  const filenameRegex = text(options.filename_regex, 200)
  if (filenameRegex) conditions.push(contains('original_name', filenameRegex, true, options.filename_regex_case_insensitive !== false))
  const visibility = text(options.visibility, 20)
  if (visibility && visibility !== 'all') {
    if (!['public', 'private'].includes(visibility)) bad('Invalid media visibility')
    conditions.push(`visibility = ${bind(visibility)}`)
  }
  const type = options.type || 'all'
  const documents = "['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md']", archives = "['zip', 'rar', '7z', 'tar', 'gz']"
  const types: Record<string, string> = {all: 'true', image: 'is_image = true', video: "string::starts_with(mime_type, 'video/')", audio: "string::starts_with(mime_type, 'audio/')", document: `string::lowercase(extension) IN ${documents}`, archive: `string::lowercase(extension) IN ${archives}`, other: `is_image = false AND !string::starts_with(mime_type, 'video/') AND !string::starts_with(mime_type, 'audio/') AND string::lowercase(extension) NOT IN ${documents} AND string::lowercase(extension) NOT IN ${archives}`}
  if (!types[type]) bad('Invalid media type')
  conditions.push(`(${types[type]})`)
  if (options.mime_type) conditions.push(`mime_type = ${bind(text(options.mime_type, 120))}`)
  if (options.folder) {
    const folder = text(options.folder, 120), id = recordIdPart(folder, 'folder')
    const record = await queryDbRecord(db, 'folder', id)
    const predicate = `folders CONTAINS type::record('folder', ${bind(id)})`
    conditions.push(record?.slug === 'default' ? `(${predicate} OR folders = [])` : predicate)
  }
  const tags = [...(options.tags ?? []), ...(options.tag ? [options.tag] : [])]
  if (tags.length > 20) bad('Too many media tags')
  if (tags.length) {
    const predicates = tags.map(tag => {
      const query = text(tag, 80), parameter = bind(regex ? mediaRegex(query, insensitive) : insensitive ? query.toLowerCase() : query)
      return regex ? `array::len(array::filter(tags, |$tag| string::matches($tag, ${parameter}))) > 0`
        : insensitive ? `array::map(tags, |$tag| string::lowercase($tag)) CONTAINS ${parameter}` : `tags CONTAINS ${parameter}`
    })
    conditions.push(`(${predicates.join(options.tag_relation === 'or' ? ' OR ' : ' AND ')})`)
  }
  let from: Date | undefined, to: Date | undefined
  for (const [column, value, end] of [['uploaded_at', options.uploaded_from, false], ['uploaded_at', options.uploaded_to, true]] as const) {
    if (!value) continue
    const input = text(value, 40)
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(input) ? `${input}T${end ? '23:59:59.999' : '00:00:00.000'}Z` : input)
    if (!Number.isFinite(date.getTime())) bad('Invalid media date filter')
    if (end) to = date; else from = date
    conditions.push(`${column} ${end ? '<=' : '>='} ${bind(date)}`)
  }
  if (from && to && from > to) bad('Invalid media date range')
  for (const [value, operator] of [[options.size_min, '>='], [options.size_max, '<=']] as const) if (value !== undefined) conditions.push(`size ${operator} ${bind(mediaInteger(value, 0, 0, Number.MAX_SAFE_INTEGER))}`)
  if (options.size_min !== undefined && options.size_max !== undefined && options.size_min > options.size_max) bad('Invalid media size range')
  if (options.orphan) conditions.push('reference_count = 0 AND referenced_by = []')
  const search = text(options.search)
  let tier = '', truncated = false
  if (search && regex) conditions.push(`(${contains('original_name', search)} OR ${contains('extension', search)} OR ${contains('comment', search)})`)
  else if (search) {
    // A bounded, authorized corpus slice for typo correction. No global vocabulary
    // allocation. Exact FTS is never capped before final scope/filter/pagination.
    const candidates = queryRows<{id: unknown, original_name: string, comment?: string}>(await queryDb(db, `SELECT id, string::slice(original_name, 0, 255) AS original_name, string::slice(comment ?? '', 0, 2000) AS comment FROM files WITH NOINDEX WHERE ${conditions.join(' AND ')} ORDER BY id LIMIT 513 TIMEOUT 5s;`, params, {retry: 'readOnly', timeoutMs: 6000}))
    truncated = candidates.length > 512
    const vocabulary = new Map<string, number>()
    for (const file of candidates.slice(0, 512)) {
      const words = extractVocabularyWords(`${file.original_name} ${file.comment ?? ''}`)
      if (words.length > 64) truncated = true
      for (const word of words.slice(0, 64)) {
        if (vocabulary.size >= 4096 && !vocabulary.has(word)) {truncated = true; continue}
        vocabulary.set(word, (vocabulary.get(word) ?? 0) + 1)
      }
    }
    const corrections = new Map<string, FuzzyCandidate[]>(), lookupWords = fuzzyLookupWords(search)
    if (lookupWords.length > 4) truncated = true
    for (const word of lookupWords.slice(0, 4)) {
      const lookup = findFuzzyCandidates(word, vocabulary)
      if (!lookup.known && lookup.candidates.length) corrections.set(word, lookup.candidates)
    }
    const needles = [search, ...buildFuzzyVariants(search, corrections).map(variant => variant.text)].slice(0, 8)
    // Distinct match references per needle keep exact/fuzzy ranking contexts
    // explicit; the engine chooses the column's actual full-text index.
    const matches = needles.map((needle, index) => {const parameter = bind(clampFtsNeedle(needle)); return `(original_name @${index * 2}@ ${parameter} OR comment @${index * 2 + 1}@ ${parameter})`})
    conditions.push(`(${matches.join(' OR ')})`)
    tier = `IF ${matches[0]} THEN 0 ELSE 1 END AS search_tier`
  }
  return {where: conditions.join(' AND '), params, page, limit, order: `${tier ? 'search_tier ASC, ' : ''}${sorts[sort]}`, tier, truncated}
}
