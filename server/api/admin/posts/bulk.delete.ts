import { requireOwner } from '../../../utils/auth'
import { queryDbRecord, useDb } from '../../../utils/db'
import { recordIdPart } from '../../../utils/surrealResult'
import { archiveOrDeletePostById } from '../../../utils/postArchiveDelete'

type BulkBody = {
  ids?: string[]
}

export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const body = await readBody<BulkBody>(event)
  const rawIds = Array.isArray(body?.ids) ? body.ids : []
  const ids = Array.from(new Set(rawIds.map((id) => recordIdPart(id, 'post')).filter(Boolean)))

  if (!ids.length) {
    throw createError({ statusCode: 400, message: 'ids[] is required' })
  }

  if (ids.length > 200) {
    throw createError({ statusCode: 400, message: 'Maximum 200 posts per bulk operation' })
  }

  const db = await useDb()
  const archivedIds: string[] = []
  const deletedIds: string[] = []
  const failed: Array<{ id: string, message: string }> = []

  await runWithConcurrency(ids, 6, async (id) => {
    try {
      const existing = await queryDbRecord(db, 'post', id)
      if (!existing) {
        throw createError({ statusCode: 404, message: 'Post not found' })
      }

      const result = await archiveOrDeletePostById(db, id)
      if (result.kind === 'archived') {
        archivedIds.push(result.post.id)
      } else {
        deletedIds.push(result.id)
      }
    } catch (error: any) {
      failed.push({ id: `post:${id}`, message: error?.statusMessage ?? error?.message ?? 'Unknown error' })
    }
  })

  return {
    archived: archivedIds.length,
    deleted: deletedIds.length,
    failed: failed.length,
    archived_ids: archivedIds,
    deleted_ids: deletedIds,
    failures: failed
  }
})

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  const size = Math.max(1, Math.min(concurrency, items.length))
  let index = 0

  await Promise.all(Array.from({ length: size }, async () => {
    while (index < items.length) {
      const current = items[index]
      index += 1
      if (current !== undefined) {
        await worker(current)
      }
    }
  }))
}
