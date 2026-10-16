import { queryDb, useDb } from '../../utils/db'
import { queryRows } from '../../utils/surrealResult'
import { isOwner } from '../../utils/auth'
import { assertPublicFeatureEnabled } from '../../utils/publicFeatures'

interface PublishFrequencyEntry {
  slug: string
  title: string
  published_at: string
}

interface PublishFrequencyResponse {
  posts: PublishFrequencyEntry[]
}

export default defineEventHandler(async (event): Promise<PublishFrequencyResponse> => {
  await assertPublicFeatureEnabled('publish_heatmap_enabled')

  const isAdmin = await isOwner(event)
  const visibilityFilter = isAdmin
    ? ''
    : 'AND (visibility IN ["public", "password"] OR visibility IS NONE)'

  const db = await useDb()
  const response = await queryDb(
    db,
    `SELECT slug, title, published_at
     FROM post
     WHERE status = "published"
       AND published_at != NONE
       ${visibilityFilter}
     ORDER BY published_at ASC;`
  )

  const rows = queryRows<Record<string, unknown>>(response, 0)
  const posts = rows
    .map<PublishFrequencyEntry | null>((row) => {
      const published = row.published_at ? String(row.published_at) : ''
      if (!published) return null
      return {
        slug: String(row.slug ?? ''),
        title: String(row.title ?? ''),
        published_at: published
      }
    })
    .filter((entry): entry is PublishFrequencyEntry => entry !== null)

  return {
    posts
  }
})
