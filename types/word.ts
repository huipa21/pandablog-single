export interface WordSense {
  id: string
  partOfSpeech: string
  definition: string
  example: string | null
  note: string | null
  translations: Record<string, string>
}

export interface WordRecord {
  id: string
  headword: string
  language: string
  pronunciation: string | null
  senses: WordSense[]
  archived: boolean
  created_at: string | null
  updated_at: string | null
}

export interface WordCardAttrs {
  wordId: string
  headword: string
  senseIds: string[]
  targetLanguage: string
  blockWidth?: 'content' | 'wide' | 'full-bleed'
}

export interface WordInputSense {
  id?: string
  partOfSpeech: string
  definition: string
  example?: string
  note?: string
  translations?: Record<string, string>
}

export interface WordInput {
  headword: string
  language: string
  pronunciation?: string
  senses: WordInputSense[]
  archived?: boolean
}
