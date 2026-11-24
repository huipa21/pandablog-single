import { queryDb, useDb } from '../../../../utils/db'
import { requireOwner } from '../../../../utils/auth'
import { collectPostEmbedIds } from '../../../../utils/postEmbedResolve'
import { queryRows, recordIdPart, stringifyRecordId } from '../../../../utils/surrealResult'

interface PostRow {
  id: unknown
  title?: unknown
  slug?: unknown
  status?: unknown
}

/**
 * Find where a post is referenced as an embedded post node (card or inline
 * chip) across the current content of all non-archived posts. Used to warn
 * before deleting, archiving or drafting a post that other content points at.
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const targetId = recordIdPart(getRouterParam(event, 'id') ?? '', 'post')
  if (!targetId) {
    throw createError({ statusCode: 400, message: 'Post id is required' })
  }

  const db = await useDb()
  const postResponse = await queryDb(
    db,
    `SELECT id, title, slug, status FROM post WHERE status != 'archived' ORDER BY title ASC;`,
    undefined,
    { label: 'post embed usage posts' }
  )
  const posts = queryRows<PostRow>(postResponse)
  if (!posts.length) {
    return { posts: [] }
  }

  // One round trip: read the current version's blocks of every non-archived
  // post (statement per post), then scan block nodes in memory.
  const statements: string[] = []
  const params: Record<string, unknown> = {}
  const versionKeys: string[] = []
  posts.forEach((post, index) => {
    const key = stringifyRecordId(post.id)
    versionKeys.push(key)
    params[`v${index}`] = `${recordIdPart(key, 'post')}__current`
    statements.push(
      `SELECT seq, out FROM has_blocks
       WHERE in = type::record('versions', $v${index})
       ORDER BY seq ASC
       FETCH out;`
    )
  })

  const blocksResponse = await queryDb(
    db,
    statements.join('\n'),
    params,
    { label: 'post embed usage blocks' }
  )

  const referencing: Array<{ id: string, title: string, slug: string, status: string }> = []
  posts.forEach((post, index) => {
    const ids = new Set<string>()
    for (const row of queryRows<{ out?: { node?: unknown } }>(blocksResponse, index)) {
      collectPostEmbedIds(row.out?.node, ids)
    }
    // Node attrs store the full record id ("post:<id>"); the route param may
    // arrive either way, so accept both spellings.
    if (!ids.has(targetId) && !ids.has(`post:${targetId}`)) {
      return
    }
    referencing.push({
      id: stringifyRecordId(post.id),
      title: String(post.title ?? ''),
      slug: String(post.slug ?? ''),
      status: post.status === 'published' ? 'published' : 'draft'
    })
  })

  return { posts: referencing.filter(post => post.id && post.title) }
})
