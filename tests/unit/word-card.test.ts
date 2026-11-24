import { describe, expect, it } from 'vitest'
import type { JsonContent } from '../../types/content'
import type { WordRecord } from '../../types/word'
import { isEmptyBlock } from '../../utils/emptyBlocks'
import {
  groupSensesByPartOfSpeech,
  normalizeSenseIds,
  normalizeWordSense,
  normalizeWordSenses,
  parseSenseIdsAttribute,
  selectWordSenses
} from '../../utils/words'
import { collectWordCardIds } from '../../server/utils/words'

function word(): WordRecord {
  return {
    id: 'word:terminate',
    headword: 'terminate',
    language: 'en',
    pronunciation: '/ˈtɜːmɪneɪt/',
    archived: false,
    created_at: null,
    updated_at: null,
    senses: [
      {
        id: 'verb-end',
        partOfSpeech: 'verb',
        definition: 'bring to an end',
        example: 'terminate the contract',
        note: null,
        translations: { 'zh-CN': '终止' }
      },
      {
        id: 'verb-kill',
        partOfSpeech: 'verb',
        definition: 'kill someone',
        example: null,
        note: 'euphemistic',
        translations: {}
      },
      {
        id: 'adj-final',
        partOfSpeech: 'adjective',
        definition: 'coming to an end',
        example: null,
        note: null,
        translations: { 'zh-CN': '末端的' }
      }
    ]
  }
}

describe('word card helpers', () => {
  it('selects only the requested senses and keeps lexicon order', () => {
    expect(selectWordSenses(word(), ['adj-final', 'verb-kill']).map(sense => sense.id))
      .toEqual(['verb-kill', 'adj-final'])
  })

  it('shows all senses when no subset is stored', () => {
    expect(selectWordSenses(word(), [])).toHaveLength(3)
    expect(selectWordSenses(word(), ['missing'])).toHaveLength(0)
  })

  it('groups senses by part of speech without losing order', () => {
    const groups = groupSensesByPartOfSpeech(word().senses)
    expect(groups.map(group => group.partOfSpeech)).toEqual(['verb', 'adjective'])
    expect(groups[0]?.senses).toHaveLength(2)
  })

  it('normalises sense ids from arrays and HTML attributes', () => {
    expect(normalizeSenseIds([' a ', 'a', '', 2, 'b'])).toEqual(['a', '2', 'b'])
    expect(parseSenseIdsAttribute('["a","b"]')).toEqual(['a', 'b'])
    expect(parseSenseIdsAttribute('not json')).toEqual([])
  })

  it('drops senses without definitions and normalises editable fields', () => {
    const senses = normalizeWordSenses([
      { partOfSpeech: ' verb ', definition: '  end  ', example: 'x', note: '', translations: { 'zh-CN': ' 终止 ' } },
      { definition: '   ' },
      null
    ])
    expect(senses).toHaveLength(1)
    expect(senses[0]).toMatchObject({
      partOfSpeech: 'verb',
      definition: 'end',
      example: 'x',
      note: null,
      translations: { 'zh-CN': '终止' }
    })
    expect(normalizeWordSense({ definition: 'end' })?.partOfSpeech).toBe('noun')
  })

  it('drops word cards without an anchor', () => {
    expect(isEmptyBlock({ type: 'wordCard', attrs: { wordId: '' } })).toBe(true)
    expect(isEmptyBlock({ type: 'wordCard', attrs: { wordId: 'word:terminate' } })).toBe(false)
  })

  it('collects word ids through nested blocks', () => {
    const doc: JsonContent = {
      type: 'doc',
      content: [
        { type: 'wordCard', attrs: { wordId: 'word:terminate' } },
        {
          type: 'columnsBlock',
          content: [{
            type: 'columnItem',
            content: [{ type: 'wordCard', attrs: { wordId: 'word:eliminate' } }]
          }]
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'plain' }] }
      ]
    }
    expect([...collectWordCardIds(doc)].sort()).toEqual(['word:eliminate', 'word:terminate'])
  })
})
