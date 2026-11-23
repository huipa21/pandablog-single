import { describe, expect, it } from 'vitest'
import {
  ADMIN_POST_DEFAULT_SORT_DIR,
  ADMIN_POST_DEFAULT_SORT_KEY,
  createDefaultAdminPostListPrefs,
  normalizeAdminPostListPrefs,
  parseAdminPostListPrefs
} from '~/utils/adminPostListPrefs'

describe('admin post list prefs', () => {
  it('defaults to published descending', () => {
    const prefs = createDefaultAdminPostListPrefs()

    expect(prefs.sortKey).toBe('published')
    expect(prefs.sortDir).toBe('desc')
    expect(ADMIN_POST_DEFAULT_SORT_KEY).toBe('published')
    expect(ADMIN_POST_DEFAULT_SORT_DIR).toBe('desc')
  })

  it('returns fresh defaults for missing or malformed storage', () => {
    expect(parseAdminPostListPrefs(null).sortKey).toBe('published')
    expect(parseAdminPostListPrefs('{not json').sortDir).toBe('desc')

    const first = createDefaultAdminPostListPrefs()
    const second = createDefaultAdminPostListPrefs()
    first.selectedTagIds.push('tag:1')

    expect(second.selectedTagIds).toEqual([])
  })

  it('restores sort, filters, and per-page values', () => {
    const prefs = parseAdminPostListPrefs(JSON.stringify({
      titleQuery: 'hello',
      tagSearch: 'vue',
      categorySearch: 'news',
      selectedStatuses: ['draft', 'published', 'draft'],
      selectedVisibilities: ['private'],
      selectedTagIds: [' tag:1 ', 'tag:1', 'tag:2'],
      selectedCategoryIds: ['category:1'],
      lengthMin: '10',
      lengthMax: '20.9',
      publishedFrom: '2025-01-01',
      publishedTo: '2025-12-31',
      updatedFrom: '2025-02-01',
      updatedTo: '2025-11-30',
      sortKey: 'title',
      sortDir: 'asc',
      perPage: '50'
    }))

    expect(prefs).toEqual({
      titleQuery: 'hello',
      tagSearch: 'vue',
      categorySearch: 'news',
      selectedStatuses: ['draft', 'published'],
      selectedVisibilities: ['private'],
      selectedTagIds: ['tag:1', 'tag:2'],
      selectedCategoryIds: ['category:1'],
      lengthMin: '10',
      lengthMax: '20',
      publishedFrom: '2025-01-01',
      publishedTo: '2025-12-31',
      updatedFrom: '2025-02-01',
      updatedTo: '2025-11-30',
      sortKey: 'title',
      sortDir: 'asc',
      perPage: '50'
    })
  })

  it('drops unknown enums and invalid dates or counts', () => {
    const prefs = normalizeAdminPostListPrefs({
      selectedStatuses: ['draft', 'unknown'],
      selectedVisibilities: ['public', 'secret'],
      lengthMin: '-1',
      lengthMax: 'not-a-number',
      publishedFrom: '2025-02-31',
      publishedTo: 'not-a-date',
      updatedFrom: '2025-02-28',
      updatedTo: '2025-13-01',
      sortKey: 'unknown',
      sortDir: 'sideways',
      perPage: '999'
    })

    expect(prefs.selectedStatuses).toEqual(['draft'])
    expect(prefs.selectedVisibilities).toEqual(['public'])
    expect(prefs.lengthMin).toBe('')
    expect(prefs.lengthMax).toBe('')
    expect(prefs.publishedFrom).toBe('')
    expect(prefs.publishedTo).toBe('')
    expect(prefs.updatedFrom).toBe('2025-02-28')
    expect(prefs.updatedTo).toBe('')
    expect(prefs.sortKey).toBe('published')
    expect(prefs.sortDir).toBe('desc')
    expect(prefs.perPage).toBe('10')
  })
})
