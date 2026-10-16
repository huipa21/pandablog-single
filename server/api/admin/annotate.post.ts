import { z } from 'zod'
import { annotate, ANNOT_LANGS } from '../../utils/annotate'
import { requireOwner } from '../../utils/auth'

const MAX_ANNOTATION_TEXT_LENGTH = 5000

const requestSchema = z.object({
  text: z.string(),
  lang: z.enum(ANNOT_LANGS)
})

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const body = await readBody<unknown>(event)
  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    throw createError({ statusCode: 400, message: 'Invalid annotation request' })
  }

  const { text, lang } = parsed.data
  if (!text.trim()) {
    throw createError({ statusCode: 400, message: 'Text is required' })
  }
  if (text.trim().length > MAX_ANNOTATION_TEXT_LENGTH) {
    throw createError({ statusCode: 413, message: 'Text is too long' })
  }

  try {
    return { segments: await annotate(text, lang) }
  } catch (error) {
    console.error('[annotate] failed', error)
    throw createError({ statusCode: 500, message: 'annotation_failed' })
  }
})