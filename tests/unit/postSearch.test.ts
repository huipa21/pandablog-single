import { describe, expect, it, vi } from 'vitest'
import type { SearchPostResult } from '../../types/content'

vi.mock('../../server/utils/db', () => ({ queryDb: vi.fn() }))

const { expandCategoryIds, sortSearchResults, toSafeSnippet, HIGHLIGHT_OPEN, HIGHLIGHT_CLOSE } = await import('../../server/utils/postSearch')

function ranked(title: string, tier: 'exact' | 'fuzzy', score: number, sortDate: number) {
  const result = {
    post: { id: `post:${title}`, slug: title, title },
    score,
    matches: [],
    totalMatches: 0,
    tier,
    status: 'published',
    locked: false
  } as SearchPostResult
  return { result, sortDate }
}

describe('sortSearchResults', () => {
  const items = () => [
    ranked('fuzzy-best', 'fuzzy', 100, 30),
    ranked('exact-low', 'exact', 1, 10),
    ranked('exact-high', 'exact', 5, 20)
  ]

  it('always ranks exact matches above fuzzy matches', () => {
    for (const sort of ['relevance', 'date_desc', 'date_asc', 'title'] as const) {
      const list = items()
      sortSearchResults(list, sort)
      expect(list.at(-1)!.result.tier).toBe('fuzzy')
    }
  })

  it('applies the requested order within a tier', () => {
    const byRelevance = items()
    sortSearchResults(byRelevance, 'relevance')
    expect(byRelevance.map((item) => item.result.post.title)).toEqual(['exact-high', 'exact-low', 'fuzzy-best'])

    const byOldest = items()
    sortSearchResults(byOldest, 'date_asc')
    expect(byOldest.map((item) => item.result.post.title)).toEqual(['exact-low', 'exact-high', 'fuzzy-best'])
  })
})

describe('expandCategoryIds', () => {
  const rows = [
    { id: 'category:tools', slug: 'tools', parent: null },
    { id: 'category:ci', slug: 'ci', parent: 'category:tools' },
    { id: 'category:runners', slug: 'runners', parent: 'category:ci' },
    { id: 'category:food', slug: 'food', parent: null }
  ]

  it('includes all descendants of the selected categories', () => {
    expect(expandCategoryIds(rows, ['tools'])).toEqual(['category:tools', 'category:ci', 'category:runners'])
    expect(expandCategoryIds(rows, ['ci', 'food'])).toEqual(['category:ci', 'category:food', 'category:runners'])
  })

  it('ignores unknown slugs and survives parent cycles', () => {
    expect(expandCategoryIds(rows, ['missing'])).toEqual([])
    const cyclic = [
      { id: 'category:a', slug: 'a', parent: 'category:b' },
      { id: 'category:b', slug: 'b', parent: 'category:a' }
    ]
    expect(expandCategoryIds(cyclic, ['a'])).toEqual(['category:a', 'category:b'])
  })
})

describe('toSafeSnippet', () => {
  it('escapes indexed HTML and only restores highlight marks', () => {
    expect(toSafeSnippet(`<img src=x onerror=alert(1)> ${HIGHLIGHT_OPEN}github${HIGHLIGHT_CLOSE}`))
      .toBe('&lt;img src=x onerror=alert(1)&gt; <mark>github</mark>')
  })
})
