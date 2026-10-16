import { describe, expect, it } from 'vitest'
import {
  SEARCH_LIMITS,
  buildSearchCriteriaQuery,
  collectSearchTerms,
  createEmptySearchCriteria,
  describeSearchKeywords,
  evaluateSearchExpression,
  hasAdvancedSearchCriteria,
  hasAnySearchCriteria,
  parseSearchCriteria,
  parseSearchKeywordGroups,
  resolveSearchDateRange,
  searchTermKey,
  serializeSearchKeywordGroups,
  splitSearchTerms,
  type AdvancedSearchCriteria
} from '../../utils/searchQuery'

function criteria(overrides: Partial<AdvancedSearchCriteria>): AdvancedSearchCriteria {
  return { ...createEmptySearchCriteria(), ...overrides }
}

describe('splitSearchTerms', () => {
  it('splits on ASCII and CJK commas, trims and de-duplicates', () => {
    expect(splitSearchTerms(' github ,GitHub, gitlab，docker、  ,')).toEqual(['github', 'gitlab', 'docker'])
  })

  it('caps the number and length of terms', () => {
    const terms = splitSearchTerms(Array.from({ length: 9 }, (_, i) => `term${i}`).join(','))
    expect(terms).toHaveLength(SEARCH_LIMITS.maxTermsPerGroup)
    expect(splitSearchTerms('x'.repeat(100))[0]).toHaveLength(SEARCH_LIMITS.maxTermLength)
  })

  it('never keeps the group separator inside a term', () => {
    expect(splitSearchTerms('a;b')).toEqual(['a b'])
  })
})

describe('keyword group serialization', () => {
  it('round-trips groups', () => {
    const groups = [
      { op: 'or' as const, terms: ['github', 'gitlab'] },
      { op: 'and' as const, terms: ['ci', 'github actions'] }
    ]
    const raw = serializeSearchKeywordGroups(groups)
    expect(raw).toBe('or:github,gitlab;and:ci,github actions')
    expect(parseSearchKeywordGroups(raw)).toEqual(groups)
  })

  it('defaults a missing operator to OR and drops empty groups', () => {
    expect(parseSearchKeywordGroups('docker;and:;or:  ')).toEqual([{ op: 'or', terms: ['docker'] }])
  })

  it('caps the number of groups', () => {
    const raw = Array.from({ length: 9 }, (_, i) => `or:t${i}`).join(';')
    expect(parseSearchKeywordGroups(raw)).toHaveLength(SEARCH_LIMITS.maxGroups)
  })
})

describe('parseSearchCriteria / buildSearchCriteriaQuery', () => {
  it('round-trips every parameter', () => {
    const query = {
      q: 'hello',
      kw: 'or:github,gitlab;and:ci,cd',
      kwop: 'or',
      cat: 'tools,food',
      tag: 'devops',
      date: 'custom',
      start: '2024-01-01',
      end: '2024-12-31',
      tz: '-480'
    }
    const parsed = parseSearchCriteria(query)
    expect(parsed).toEqual({
      q: 'hello',
      groups: [{ op: 'or', terms: ['github', 'gitlab'] }, { op: 'and', terms: ['ci', 'cd'] }],
      groupOp: 'or',
      categories: ['tools', 'food'],
      tags: ['devops'],
      date: 'custom',
      start: '2024-01-01',
      end: '2024-12-31',
      tz: -480
    })
    expect(buildSearchCriteriaQuery(parsed)).toEqual(query)
  })

  it('ignores invalid values', () => {
    const parsed = parseSearchCriteria({ date: 'forever', start: '2024-13-99x', tz: '9999', kwop: 'xor' })
    expect(parsed.date).toBe('')
    expect(parsed.start).toBe('')
    expect(parsed.tz).toBeNull()
    expect(parsed.groupOp).toBe('and')
  })

  it('omits empty values and custom dates for presets', () => {
    expect(buildSearchCriteriaQuery(criteria({ q: ' ', date: '7d', start: '2024-01-01' }))).toEqual({ date: '7d' })
  })
})

describe('criteria predicates', () => {
  it('distinguishes plain, advanced and empty searches', () => {
    expect(hasAnySearchCriteria(criteria({}))).toBe(false)
    expect(hasAnySearchCriteria(criteria({ q: 'x' }))).toBe(true)
    expect(hasAdvancedSearchCriteria(criteria({ q: 'x' }))).toBe(false)
    expect(hasAdvancedSearchCriteria(criteria({ tags: ['a'] }))).toBe(true)
    expect(hasAnySearchCriteria(criteria({ date: 'custom' }))).toBe(false)
    expect(hasAnySearchCriteria(criteria({ date: 'custom', end: '2024-01-01' }))).toBe(true)
  })
})

describe('evaluateSearchExpression', () => {
  const matching = (...terms: string[]) => {
    const set = new Set(terms.map(searchTermKey))
    return (key: string) => set.has(key)
  }

  it('evaluates (A OR B) AND (C OR D)', () => {
    const expr = criteria({
      groups: [{ op: 'or', terms: ['A', 'B'] }, { op: 'or', terms: ['C', 'D'] }],
      groupOp: 'and'
    })
    expect(evaluateSearchExpression(expr, matching('a', 'd'))).toBe(true)
    expect(evaluateSearchExpression(expr, matching('a', 'b'))).toBe(false)
  })

  it('evaluates (A AND B) OR (C AND D)', () => {
    const expr = criteria({
      groups: [{ op: 'and', terms: ['A', 'B'] }, { op: 'and', terms: ['C', 'D'] }],
      groupOp: 'or'
    })
    expect(evaluateSearchExpression(expr, matching('c', 'd'))).toBe(true)
    expect(evaluateSearchExpression(expr, matching('a', 'c'))).toBe(false)
  })

  it('always requires the plain query', () => {
    const expr = criteria({ q: 'Q', groups: [{ op: 'or', terms: ['A'] }], groupOp: 'or' })
    expect(evaluateSearchExpression(expr, matching('a'))).toBe(false)
    expect(evaluateSearchExpression(expr, matching('q', 'a'))).toBe(true)
    expect(evaluateSearchExpression(criteria({ q: 'Q' }), matching('q'))).toBe(true)
  })

  it('is false without keywords', () => {
    expect(evaluateSearchExpression(criteria({}), () => true)).toBe(false)
  })
})

describe('collectSearchTerms', () => {
  it('de-duplicates terms and flags multi-word advanced keywords as phrases', () => {
    const terms = collectSearchTerms(criteria({
      q: 'github actions',
      groups: [{ op: 'or', terms: ['GitHub Actions', 'docker compose', 'k8s'] }]
    }))
    expect(terms).toEqual([
      { key: 'github actions', text: 'github actions', phrase: false },
      { key: 'docker compose', text: 'docker compose', phrase: true },
      { key: 'k8s', text: 'k8s', phrase: false }
    ])
  })
})

describe('describeSearchKeywords', () => {
  it('renders a readable expression', () => {
    expect(describeSearchKeywords(criteria({
      q: 'docker',
      groups: [{ op: 'or', terms: ['github', 'gitlab'] }, { op: 'and', terms: ['ci'] }],
      groupOp: 'and'
    }))).toBe('docker AND (github OR gitlab) AND ci')
    expect(describeSearchKeywords(criteria({
      groups: [{ op: 'or', terms: ['a b', 'c'] }],
      groupOp: 'and'
    }))).toBe('"a b" OR c')
  })
})

describe('resolveSearchDateRange', () => {
  const now = new Date('2024-06-15T12:00:00.000Z')

  it('resolves relative presets', () => {
    expect(resolveSearchDateRange({ date: '7d', start: '', end: '', tz: null }, now).from?.toISOString()).toBe('2024-06-08T12:00:00.000Z')
    expect(resolveSearchDateRange({ date: '12m', start: '', end: '', tz: null }, now).from?.toISOString()).toBe('2023-06-15T12:00:00.000Z')
  })

  it('resolves "this year" in the browser timezone', () => {
    // UTC+8 (getTimezoneOffset = -480): local new year is 2023-12-31T16:00Z.
    expect(resolveSearchDateRange({ date: 'year', start: '', end: '', tz: -480 }, now).from?.toISOString()).toBe('2023-12-31T16:00:00.000Z')
  })

  it('resolves custom whole days in the browser timezone', () => {
    const range = resolveSearchDateRange({ date: 'custom', start: '2024-01-01', end: '2024-01-31', tz: -480 })
    expect(range.from?.toISOString()).toBe('2023-12-31T16:00:00.000Z')
    expect(range.to?.toISOString()).toBe('2024-01-31T15:59:59.999Z')
  })

  it('swaps reversed custom ranges and supports open ends', () => {
    const range = resolveSearchDateRange({ date: 'custom', start: '2024-02-01', end: '2024-01-01', tz: 0 })
    expect(range.from!.getTime()).toBeLessThan(range.to!.getTime())
    expect(resolveSearchDateRange({ date: 'custom', start: '', end: '2024-01-01', tz: 0 }).from).toBeNull()
  })

  it('has no bounds without a date filter', () => {
    expect(resolveSearchDateRange({ date: '', start: '', end: '', tz: null })).toEqual({ from: null, to: null })
  })
})
