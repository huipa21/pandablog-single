import { requireOwner } from '../../utils/auth'
import { useDb } from '../../utils/db'
import { mediaSearchFileRecords } from '../../utils/mediaLibrary'

export default defineEventHandler(async (event) => {
  const user = await requireOwner(event)
  const query = getQuery(event)
  const db = await useDb()
  const searchRegex = query.search_regex === 'true'
  const caseInsensitive = query.case_insensitive !== 'false'
  const filenameRegex = stringQuery(query.filename_regex)
  const filenameRegexCaseInsensitive = query.filename_regex_case_insensitive !== 'false'
  const safeSearch = stringQuery(query.search)

  return await mediaSearchFileRecords(db, {
    page: Number(query.page || 1),
    limit: Number(query.limit || 24),
    search: safeSearch,
    file_name: searchTextQuery(query.file_name),
    extension: searchTextQuery(query.extension),
    comment: searchTextQuery(query.comment),
    tags: tagsQuery(query.tags),
    tag_relation: tagRelationQuery(query.tag_relation),
    filename_regex: filenameRegex,
    filename_regex_case_insensitive: filenameRegexCaseInsensitive,
    search_regex: searchRegex,
    case_insensitive: caseInsensitive,
    sort: stringQuery(query.sort),
    type: stringQuery(query.type) || 'all',
    mime_type: stringQuery(query.mime_type),
    folder: stringQuery(query.folder),
    tag: stringQuery(query.tag),
    uploaded_from: stringQuery(query.uploaded_from),
    uploaded_to: stringQuery(query.uploaded_to),
    orphan: query.orphan === 'true',
    visibility: stringQuery(query.visibility),
    size_min: nonNegativeIntQuery(query.size_min),
    size_max: nonNegativeIntQuery(query.size_max),
    visibleToUser: user
  })
})

function stringQuery(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function searchTextQuery(value: unknown) {
  return stringQuery(value).trim()
}

function nonNegativeIntQuery(value: unknown) {
  const raw = stringQuery(value).trim()
  if (!raw) return undefined
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw createError({statusCode: 400, message: 'Invalid media size filter'})
  return parsed
}

function tagsQuery(value: unknown) {
  const raw = stringQuery(value).trim()
  if (raw.length > 2048) throw createError({statusCode: 400, message: 'Invalid media tags'})
  if (!raw) return []

  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        if (parsed.length > 20 || parsed.some(item => typeof item !== 'string')) throw createError({statusCode: 400, message: 'Invalid media tags'})
        return parsed.map((item: string) => item.trim()).filter(Boolean)
      }
    } catch {
      throw createError({statusCode: 400, message: 'Invalid media tags'})
    }
  }

  const tags = raw.split(',').map((item) => item.trim()).filter(Boolean)
  if (tags.length > 20) throw createError({statusCode: 400, message: 'Invalid media tags'})
  return tags
}

function tagRelationQuery(value: unknown) {
  return stringQuery(value).toLowerCase() === 'or' ? 'or' : 'and'
}
