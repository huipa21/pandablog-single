import { createHash, randomUUID } from 'node:crypto'
import type { Surreal } from 'surrealdb'
import type { BlockRecord, JsonContent, RelatedPostSummary } from '~/types/content'
import { computeContentStats } from '../../utils/contentStats'
import { isEmptyBlock } from '../../utils/emptyBlocks'
import { normalizeBlockPresentation } from '../../utils/blockPresentation'
import { queryDb } from './db'
import { mediaReserveReferences } from './referenceTracker'
import type { SessionUser } from './users'
import { getPostVersioningSettings } from './settings'
import { firstRow, queryRows, recordIdPart, stringifyRecordId } from './surrealResult'

/** Default sequence step between adjacent blocks after a full renumber. */
export const BLOCK_SEQ_STEP = 10

const BLOCK_ID_ATTR = 'blockId'

/**
 * Build an empty Tiptap doc — used when a post has no blocks.
 */
export function emptyDoc(): JsonContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: []
      }
    ]
  }
}

/**
 * Recursively flatten visible text from any Tiptap node — used for FTS
 * indexing on the `block` row. Handles known custom node types so their
 * referenced labels make it into the index.
 */
export function flattenNodeText(node: JsonContent | null | undefined): string {
  if (!node) {
    return ''
  }

  if (node.type === 'text') {
    return node.text ?? ''
  }

  if (node.type === 'rubyUnit') {
    // Annotation atom: the visible base text lives in attrs.base. The reading
    // (attrs.reading) is phonetic furigana/pinyin/jyutping and is indexed
    // separately via collectRubyReadings so it does not split the base
    // characters apart. Without base extraction the visible characters never
    // reach block.text and annotated words (e.g. 日本語 with furigana) are
    // invisible to full-text search.
    return stringAttr(node.attrs?.base)
  }

  if (node.type === 'wikiLink') {
    return stringAttr(node.attrs?.label) || stringAttr(node.attrs?.target)
  }

  if (node.type === 'mermaid') {
    return stringAttr(node.attrs?.code)
  }

  if (node.type === 'diffBlock') {
    return [
      stringAttr(node.attrs?.oldLabel),
      stringAttr(node.attrs?.oldText),
      stringAttr(node.attrs?.newLabel),
      stringAttr(node.attrs?.newText)
    ].filter(Boolean).join(' ')
  }

  if (node.type === 'image') {
    return [stringAttr(node.attrs?.alt), stringAttr(node.attrs?.title)].filter(Boolean).join(' ')
  }

  if (node.type === 'mediaText') {
    const childText = node.content?.map(flattenNodeText).filter(Boolean).join(' ') ?? ''
    return [
      flattenFileItems(node.attrs?.mediaItems),
      stringAttr(node.attrs?.mediaName),
      stringAttr(node.attrs?.mediaAlt),
      stringAttr(node.attrs?.mediaTitle),
      childText
    ].filter(Boolean).join(' ')
  }

  if (node.type === 'filesBlock') {
    return flattenFileItems(node.attrs?.files)
  }

  if (node.type === 'customHtml') {
    // Index only the visible text of custom HTML, never the raw markup. This
    // keeps tag/attribute noise out of the FTS index and avoids storing author
    // HTML that could later be surfaced (unescaped) through a search snippet.
    return stringAttr(node.attrs?.html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  }

  // Inline textblocks (paragraph/heading) hold a run of inline nodes where the
  // text nodes already carry their own spaces. Adjacent inline atoms — notably
  // `rubyUnit` annotations — must be concatenated WITHOUT an inserted space, or
  // an annotated word like 你好 becomes "你 好" and its multi-character ngrams
  // (你好, 好世, …) never enter the index, breaking CJK search. Block-level
  // containers keep a space separator so distinct blocks stay tokenised apart.
  const childSeparator = INLINE_TEXTBLOCK_TYPES.has(node.type ?? '') ? '' : ' '
  const ownText = typeof node.text === 'string' ? node.text : ''
  const childText = node.content?.map(flattenNodeText).filter(Boolean).join(childSeparator) ?? ''
  return [ownText, childText].filter(Boolean).join(childSeparator).trim()
}

/** Node types whose children are inline content and must join without spaces. */
const INLINE_TEXTBLOCK_TYPES = new Set(['paragraph', 'heading'])

/**
 * Recursively collect annotation readings (furigana / pinyin / jyutping) from
 * every `rubyUnit` in the subtree. Returned space-joined so each reading is an
 * independent search token — searching the reading (e.g. わたし) then finds the
 * post even though the visible base text is the kanji (私). Kept separate from
 * `flattenNodeText` so appending readings never breaks the contiguous CJK base
 * (which preserves multi-character ngrams like 国際交流).
 */
export function collectRubyReadings(node: JsonContent | null | undefined): string {
  if (!node) {
    return ''
  }

  const readings: string[] = []
  const visit = (current: JsonContent | null | undefined) => {
    if (!current) {
      return
    }
    if (current.type === 'rubyUnit') {
      const reading = stringAttr(current.attrs?.reading)
      if (reading) {
        readings.push(reading)
      }
    }
    if (Array.isArray(current.content)) {
      for (const child of current.content) {
        visit(child as JsonContent)
      }
    }
  }

  visit(node)
  return readings.join(' ')
}

/**
 * Build the full-text index payload for a block: the visible base text
 * (contiguous, so CJK compounds keep their multi-character ngrams) followed by
 * annotation readings as separate tokens. Stored in `block.text`. NOT used for
 * content stats — readings are phonetic aids, not authored characters, so stats
 * are recomputed from `flattenNodeText` (base only).
 */
export function flattenBlockSearchText(node: JsonContent | null | undefined): string {
  return [flattenNodeText(node), collectRubyReadings(node)].filter(Boolean).join(' ')
}

export function computeStatsFromBlocks(blocks: BlockRecord[]) {
  const combined = blocks.map((block) => flattenNodeText(block.node)).join('\n')
  return computeContentStats(combined)
}

/**
 * A top-level node staged for saving. The blockId is stable across edits.
 */
export interface BlockInput {
  blockId: string
  node: JsonContent
  text: string
  hash: string
}

interface VersionRow {
  id: unknown
  version?: unknown
  datetime?: unknown
  diff?: unknown
}

export interface PostVersionRecord {
  id: string
  version: string
  datetime: string
  diff: BlockVersionDiffRow[]
}

export interface BlockVersionDiffRow {
  status: 'added' | 'removed' | 'changed' | 'moved' | 'unchanged'
  blockId?: string
  oldHash?: string
  newHash?: string
  oldIndex?: number
  newIndex?: number
}

interface SyncPostBlocksOptions {
  shouldSnapshot?: boolean
}

/**
 * Extract top-level blocks from a Tiptap doc, ensuring each carries a
 * stable `blockId` attribute. New blocks get a freshly minted id.
 */
export function extractBlocksFromDoc(doc: JsonContent | null | undefined): BlockInput[] {
  const blocks: BlockInput[] = []
  const seen = new Set<string>()

  if (!doc?.content) {
    return blocks
  }

  for (const raw of doc.content) {
    if (!raw || typeof raw !== 'object') {
      continue
    }

    const attrs = (raw.attrs && typeof raw.attrs === 'object') ? { ...raw.attrs } : {}
    let blockId = typeof attrs[BLOCK_ID_ATTR] === 'string' ? String(attrs[BLOCK_ID_ATTR]).trim() : ''

    if (!blockId || seen.has(blockId)) {
      blockId = randomUUID().replace(/-/g, '')
    }

    seen.add(blockId)
    attrs[BLOCK_ID_ATTR] = blockId

    const node: JsonContent = normalizeBlockPresentation({ ...raw, attrs })
    if (isEmptyBlock(node)) {
      continue
    }

    const text = flattenBlockSearchText(node)
    const hash = hashNode(node)

    blocks.push({ blockId, node, text, hash })
  }

  return blocks
}

/**
 * Reassemble a Tiptap doc from an ordered list of stored blocks.
 */
export function buildDocFromBlocks(blocks: BlockRecord[]): JsonContent {
  if (!blocks.length) {
    return emptyDoc()
  }

  return {
    type: 'doc',
    content: blocks.map((block) => block.node)
  }
}

/**
 * Stable JSON hash of a node — used for diffing blocks on save so the server
 * only writes blocks whose content has actually changed.
 */
export function hashNode(node: JsonContent): string {
  return createHash('sha256').update(stableStringify(node)).digest('hex')
}

function versionRecordId(postId: string, version: string): string {
  return `${postId}__${version}`
}

function currentVersionRecordId(postId: string): string {
  return versionRecordId(postId, 'current')
}

function versionLabelFromDate(value = new Date()): string {
  const year = String(value.getUTCFullYear()).slice(-2)
  const month = String(value.getUTCMonth() + 1).padStart(2, '0')
  const day = String(value.getUTCDate()).padStart(2, '0')
  const hour = String(value.getUTCHours()).padStart(2, '0')
  const minute = String(value.getUTCMinutes()).padStart(2, '0')
  const second = String(value.getUTCSeconds()).padStart(2, '0')
  const millis = String(value.getUTCMilliseconds()).padStart(3, '0')
  return `${year}${month}${day}${hour}${minute}${second}${millis}`
}

function blockIdFromNode(node: JsonContent): string {
  const value = node.attrs?.[BLOCK_ID_ATTR]
  return typeof value === 'string' ? value : ''
}

function lightweightBlockDiff(oldBlocks: BlockRecord[], newBlocks: BlockRecord[]): BlockVersionDiffRow[] {
  const oldByBlockId = new Map(oldBlocks.map((block, index) => [blockIdFromNode(block.node) || block.id, { block, index }]))
  const newByBlockId = new Map(newBlocks.map((block, index) => [blockIdFromNode(block.node) || block.id, { block, index }]))
  const rows: BlockVersionDiffRow[] = []

  for (const [key, current] of newByBlockId) {
    const previous = oldByBlockId.get(key)
    if (!previous) {
      rows.push({ status: 'added', blockId: blockIdFromNode(current.block.node), newHash: recordIdPart(current.block.id, 'block'), newIndex: current.index })
      continue
    }

    const oldHash = recordIdPart(previous.block.id, 'block')
    const newHash = recordIdPart(current.block.id, 'block')
    const moved = previous.index !== current.index
    const changed = oldHash !== newHash
    rows.push({
      status: changed ? 'changed' : moved ? 'moved' : 'unchanged',
      blockId: blockIdFromNode(current.block.node),
      oldHash,
      newHash,
      oldIndex: previous.index,
      newIndex: current.index
    })
  }

  for (const [key, previous] of oldByBlockId) {
    if (newByBlockId.has(key)) continue
    rows.push({ status: 'removed', blockId: blockIdFromNode(previous.block.node), oldHash: recordIdPart(previous.block.id, 'block'), oldIndex: previous.index })
  }

  return rows.filter((row) => row.status !== 'unchanged')
}

function blocksChanged(oldBlocks: BlockRecord[], newBlocks: BlockRecord[]): boolean {
  return lightweightBlockDiff(oldBlocks, newBlocks).length > 0
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`)
  return `{${entries.join(',')}}`
}

function stringAttr(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function flattenFileItems(value: unknown) {
  if (!Array.isArray(value)) return ''
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return ''
      const attrs = item as Record<string, unknown>
      return [attrs.name, attrs.alt, attrs.title, attrs.src]
        .map(stringAttr)
        .filter(Boolean)
        .join(' ')
    })
    .filter(Boolean)
    .join(' ')
}

interface ExistingBlockRow {
  id: unknown
  type?: unknown
  node?: unknown
  text?: unknown
  content_hash?: unknown
  seq?: unknown
}

/**
 * Load all blocks belonging to a post, in sequence order, including their
 * edge sequence number.
 */
export async function loadBlocksForPost(db: Surreal, postRecordId: string): Promise<BlockRecord[]> {
  const currentVersionId = await ensureCurrentVersionForPost(db, postRecordId)
  const response = await queryDb(
    db,
    `SELECT seq, out FROM has_blocks
     WHERE in = type::record('versions', $versionId)
     ORDER BY seq ASC
     FETCH out;`,
    { versionId: currentVersionId }
  )
  const rows = queryRows<{ seq?: unknown, out?: ExistingBlockRow }>(response, 0)
  return rows
    .filter((row) => row.out && typeof row.out === 'object')
    .map((row) => {
      const out = row.out as ExistingBlockRow
      return {
        id: stringifyRecordId(out.id),
        type: String(out.type ?? 'paragraph'),
        node: (out.node && typeof out.node === 'object' ? out.node : {}) as JsonContent,
        text: String(out.text ?? ''),
        seq: Number(row.seq ?? 0)
      }
    })
}

async function ensureCurrentVersionForPost(db: Surreal, postRecordId: string): Promise<string> {
  const postId = recordIdPart(postRecordId, 'post')
  const versionId = currentVersionRecordId(postId)
  const response = await queryDb(
    db,
    `SELECT id FROM type::record('versions', $versionId);
     SELECT id FROM has_version WHERE in = type::record('post', $postId) AND out = type::record('versions', $versionId);`,
    { postId, versionId },
    { label: 'ensure current version' }
  )
  const existingVersion = firstRow<Record<string, unknown>>(response, 0)
  const existingEdge = firstRow<Record<string, unknown>>(response, 1)

  if (existingVersion && existingEdge) {
    return versionId
  }

  const statements: string[] = []
  if (!existingVersion) {
    statements.push(`CREATE type::record('versions', $versionId) CONTENT { version: 'current', datetime: time::now(), diff: [], created_at: time::now() };`)
  }
  if (!existingEdge) {
    statements.push(`RELATE (type::record('post', $postId)) -> has_version -> (type::record('versions', $versionId));`)
  }
  if (statements.length) {
    await queryDb(db, statements.join('\n'), { postId, versionId }, { label: 'create current version' })
  }

  return versionId
}

/**
 * Diff the incoming ordered block list against the post's existing blocks and
 * apply the minimal set of operations:
 *  - delete blocks that are no longer present
 *  - create blocks that are new (assigning a fresh seq via halving)
 *  - update blocks whose content_hash changed
 *  - reseq edges whenever ordering changed
 *
 * All operations are batched into minimal round-trips to avoid per-query
 * network latency overhead with remote databases.
 *
 * Returns the final ordered BlockRecord list after the diff is applied.
 */
export async function syncPostBlocks(
  db: Surreal,
  postRecordId: string,
  incoming: BlockInput[],
  existingBlocks?: BlockRecord[],
  options: SyncPostBlocksOptions = {}
): Promise<BlockRecord[]> {
  const postId = recordIdPart(postRecordId, 'post')
  const currentVersionId = await ensureCurrentVersionForPost(db, postRecordId)
  const existing = existingBlocks ?? await loadBlocksForPost(db, postRecordId)
  const nextBlocks = incoming.map((incomingBlock, index) => ({
    id: `block:${incomingBlock.hash}`,
    type: String(incomingBlock.node.type ?? 'paragraph'),
    node: incomingBlock.node,
    text: incomingBlock.text,
    seq: (index + 1) * BLOCK_SEQ_STEP
  }))
  const changed = blocksChanged(existing, nextBlocks)

  if (options.shouldSnapshot && changed && existing.length) {
    await snapshotCurrentVersion(db, postId, currentVersionId, existing, nextBlocks)
  }

  await queryDb(
    db,
    `DELETE has_blocks WHERE in = type::record('versions', $versionId);`,
    { versionId: currentVersionId },
    { label: 'clear current version blocks' }
  )

  const createStmts: string[] = []
  const createParams: Record<string, unknown> = { versionId: currentVersionId }

  const finalBlocks: BlockRecord[] = []
  for (let i = 0; i < incoming.length; i += 1) {
    const incomingBlock = incoming[i]!
    const seq = (i + 1) * BLOCK_SEQ_STEP
    const blockRecordId = `block:${incomingBlock.hash}`
    const blockType = String(incomingBlock.node.type ?? 'paragraph')

    createParams[`bid_${i}`] = incomingBlock.hash
    createParams[`typ_${i}`] = blockType
    createParams[`nod_${i}`] = incomingBlock.node
    createParams[`txt_${i}`] = incomingBlock.text
    createParams[`seq_${i}`] = seq
    createStmts.push(
      `UPSERT type::record('block', $bid_${i}) CONTENT { type: $typ_${i}, node: $nod_${i}, text: $txt_${i}, content_hash: $bid_${i}, created_at: time::now(), updated_at: time::now() };`
    )
    createStmts.push(
      `RELATE (type::record('versions', $versionId)) -> has_blocks -> (type::record('block', $bid_${i})) CONTENT { seq: $seq_${i} };`
    )

    finalBlocks.push({
      id: blockRecordId,
      type: blockType,
      node: incomingBlock.node,
      text: incomingBlock.text,
      seq
    })
  }

  if (createStmts.length) {
    await queryDb(db, createStmts.join('\n'), createParams, { label: `batch-save ${createStmts.length / 2} version blocks` })
  }

  return finalBlocks
}

async function snapshotCurrentVersion(
  db: Surreal,
  postId: string,
  currentVersionId: string,
  existingBlocks: BlockRecord[],
  nextBlocks: BlockRecord[]
) {
  const currentResponse = await queryDb(
    db,
    `SELECT id, version, datetime, diff FROM type::record('versions', $currentVersionId);`,
    { currentVersionId },
    { label: 'read current version before snapshot' }
  )
  const current = firstRow<VersionRow>(currentResponse)
  const currentDatetime = parseDateLike(current?.datetime) ?? new Date()
  const snapshotLabel = versionLabelFromDate(currentDatetime)
  const snapshotVersionId = versionRecordId(postId, snapshotLabel)
  const diff = lightweightBlockDiff(existingBlocks, nextBlocks)

  // Idempotency guard: rapid/overlapping saves can read the same current
  // datetime and derive the same snapshot id. If the snapshot already exists,
  // never RELATE a second edge to it (that produced duplicate "versions" in the
  // UI, all pointing at one record). Just ensure a single edge and refresh the
  // current marker.
  const existing = await queryDb(
    db,
    `SELECT id FROM type::record('versions', $snapshotVersionId);
     SELECT id FROM has_version WHERE in = type::record('post', $postId) AND out = type::record('versions', $snapshotVersionId);`,
    { snapshotVersionId, postId },
    { label: 'check existing snapshot version' }
  )
  const snapshotExists = Boolean(firstRow<Record<string, unknown>>(existing, 0))
  const edgeExists = Boolean(firstRow<Record<string, unknown>>(existing, 1))

  if (snapshotExists) {
    const repair: string[] = []
    if (!edgeExists) {
      repair.push(`RELATE (type::record('post', $postId)) -> has_version -> (type::record('versions', $snapshotVersionId));`)
    }
    repair.push(`UPDATE type::record('versions', $currentVersionId) MERGE { datetime: time::now(), diff: $diff };`)
    await queryDb(
      db,
      repair.join('\n'),
      { postId, snapshotVersionId, currentVersionId, diff },
      { label: `snapshot current version ${snapshotLabel} (exists)` }
    )
    return
  }

  const stmts: string[] = [
    `UPSERT type::record('versions', $snapshotVersionId) CONTENT { version: $snapshotLabel, datetime: $snapshotDatetime, diff: $diff, created_at: time::now() };`,
    `RELATE (type::record('post', $postId)) -> has_version -> (type::record('versions', $snapshotVersionId));`
  ]
  const params: Record<string, unknown> = {
    postId,
    snapshotVersionId,
    snapshotLabel,
    snapshotDatetime: currentDatetime,
    currentVersionId,
    diff
  }

  for (let i = 0; i < existingBlocks.length; i += 1) {
    const block = existingBlocks[i]!
    params[`bid_${i}`] = recordIdPart(block.id, 'block')
    params[`seq_${i}`] = block.seq
    stmts.push(
      `RELATE (type::record('versions', $snapshotVersionId)) -> has_blocks -> (type::record('block', $bid_${i})) CONTENT { seq: $seq_${i} };`
    )
  }
  stmts.push(`UPDATE type::record('versions', $currentVersionId) MERGE { datetime: time::now(), diff: $diff };`)

  await queryDb(db, stmts.join('\n'), params, { label: `snapshot current version ${snapshotLabel}` })
  await prunePostVersions(db, `post:${postId}`)
}

async function prunePostVersions(db: Surreal, postRecordId: string): Promise<void> {
  const { snapshot_limit: snapshotLimit } = await getPostVersioningSettings()
  const versions = await loadVersionsForPost(db, postRecordId)
  const excess = versions.sort((a, b) => b.version.localeCompare(a.version)).slice(snapshotLimit)
  for (const version of excess) {
    await deletePostVersion(db, postRecordId, version.version)
  }
}

function parseDateLike(value: unknown): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null
  const parsed = new Date(String(value))
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

export async function loadVersionsForPost(db: Surreal, postRecordId: string): Promise<PostVersionRecord[]> {
  const postId = recordIdPart(postRecordId, 'post')
  const response = await queryDb(
    db,
    `SELECT out FROM has_version
     WHERE in = type::record('post', $postId)
     FETCH out;`,
    { postId },
    { label: 'load post versions' }
  )
  const seen = new Set<string>()
  return queryRows<{ out?: VersionRow }>(response, 0)
    .map((row) => normalizeVersionRow(row.out))
    .filter((version): version is PostVersionRecord => Boolean(version))
    .filter((version) => {
      if (seen.has(version.id)) return false
      seen.add(version.id)
      return true
    })
    .sort((a, b) => b.version.localeCompare(a.version))
}

export async function loadBlocksForVersion(db: Surreal, postRecordId: string, version: string): Promise<BlockRecord[]> {
  const postId = recordIdPart(postRecordId, 'post')
  const versionId = version === 'current' ? await ensureCurrentVersionForPost(db, postRecordId) : versionRecordId(postId, version)
  const response = await queryDb(
    db,
    `SELECT seq, out FROM has_blocks
     WHERE in = type::record('versions', $versionId)
     ORDER BY seq ASC
     FETCH out;`,
    { versionId },
    { label: 'load blocks for version' }
  )
  return queryRows<{ seq?: unknown, out?: ExistingBlockRow }>(response, 0)
    .filter((row) => row.out && typeof row.out === 'object')
    .map((row) => {
      const out = row.out as ExistingBlockRow
      return {
        id: stringifyRecordId(out.id),
        type: String(out.type ?? 'paragraph'),
        node: (out.node && typeof out.node === 'object' ? out.node : {}) as JsonContent,
        text: String(out.text ?? ''),
        seq: Number(row.seq ?? 0)
      }
    })
}

export async function restorePostVersion(db: Surreal, postRecordId: string, version: string, existingBlocks?: BlockRecord[], user?: SessionUser): Promise<BlockRecord[]> {
  if (version === 'current') {
    return existingBlocks ?? await loadBlocksForPost(db, postRecordId)
  }
  const targetBlocks = await loadBlocksForVersion(db, postRecordId, version)
  await mediaReserveReferences(db, postRecordId, [buildDocFromBlocks(targetBlocks)], user)
  const incoming = targetBlocks.map((block) => ({
    blockId: blockIdFromNode(block.node) || recordIdPart(block.id, 'block'),
    node: block.node,
    text: block.text,
    hash: recordIdPart(block.id, 'block')
  }))
  return await syncPostBlocks(db, postRecordId, incoming, existingBlocks, { shouldSnapshot: true })
}

export async function deletePostVersion(db: Surreal, postRecordId: string, version: string): Promise<void> {
  if (version === 'current') {
    throw createError({ statusCode: 400, message: 'Current version cannot be deleted' })
  }

  const postId = recordIdPart(postRecordId, 'post')
  const versionId = versionRecordId(postId, version)
  const blockResponse = await queryDb(
    db,
    `SELECT out AS id FROM has_blocks WHERE in = type::record('versions', $versionId);`,
    { versionId },
    { label: 'load version blocks for delete' }
  )
  const blockIds = queryRows<{ id: unknown }>(blockResponse, 0).map((row) => recordIdPart(stringifyRecordId(row.id), 'block')).filter(Boolean)
  const stmts = [
    `DELETE has_version WHERE in = type::record('post', $postId) AND out = type::record('versions', $versionId);`,
    `DELETE has_blocks WHERE in = type::record('versions', $versionId);`,
    `DELETE type::record('versions', $versionId);`
  ]
  const params: Record<string, unknown> = { postId, versionId }
  blockIds.forEach((blockId, index) => {
    params[`bid_${index}`] = blockId
    stmts.push(`DELETE type::record('block', $bid_${index}) WHERE count(<-has_blocks) = 0;`)
  })
  await queryDb(db, stmts.join('\n'), params, { label: 'delete post version' })
}

function normalizeVersionRow(row: VersionRow | undefined): PostVersionRecord | null {
  if (!row?.id) return null
  const version = String(row.version ?? '')
  if (!version || version === 'current') return null
  return {
    id: stringifyRecordId(row.id),
    version,
    datetime: parseDateLike(row.datetime)?.toISOString() ?? String(row.datetime ?? ''),
    diff: Array.isArray(row.diff) ? row.diff as BlockVersionDiffRow[] : []
  }
}

/**
 * Delete every block (and edge) belonging to a post — used when a post is
 * hard-deleted. Archive flow keeps blocks intact.
 */
export async function deleteAllBlocksForPost(db: Surreal, postRecordId: string) {
  const postId = recordIdPart(postRecordId, 'post')
  const response = await queryDb(
    db,
    `SELECT out FROM has_version
     WHERE in = type::record('post', $postId)
     FETCH out;`,
    { postId }
  )
  const versionIds = queryRows<{ out?: { id?: unknown } }>(response, 0)
    .map((row) => stringifyRecordId(row.out?.id))
    .filter(Boolean)
  const blockIds = new Set<string>()
  for (const versionRecordId of versionIds) {
    const versionId = recordIdPart(versionRecordId, 'versions')
    const blockResponse = await queryDb(
      db,
      `SELECT out AS id FROM has_blocks WHERE in = type::record('versions', $versionId);`,
      { versionId }
    )
    for (const row of queryRows<{ id: unknown }>(blockResponse, 0)) {
      blockIds.add(stringifyRecordId(row.id))
    }
  }

  const stmts: string[] = [`DELETE has_version WHERE in = type::record('post', $postId);`]
  const params: Record<string, unknown> = { postId }
  for (let i = 0; i < versionIds.length; i++) {
    const versionId = recordIdPart(versionIds[i]!, 'versions')
    params[`vid_${i}`] = versionId
    stmts.push(`DELETE has_blocks WHERE in = type::record('versions', $vid_${i});`)
    stmts.push(`DELETE type::record('versions', $vid_${i});`)
  }
  let blockIndex = 0
  for (const blockRecordId of blockIds) {
    const blockId = recordIdPart(blockRecordId, 'block')
    params[`bid_${blockIndex}`] = blockId
    stmts.push(`DELETE type::record('block', $bid_${blockIndex}) WHERE count(<-has_blocks) = 0;`)
    blockIndex += 1
  }
  await queryDb(db, stmts.join('\n'), params, { label: `batch-delete all versions for post` })
}

/* ---------- Sequence math: halving + full renumber ---------- */

/**
 * Compute a new sequence number for a block inserted between two adjacent
 * blocks (either of which may be undefined for head/tail insert).
 * Rules (per spec):
 *  - tail insert: prev + STEP
 *  - head insert: next - STEP (clamped to at least 1)
 *  - middle:     floor((prev + next) / 2)
 *  - if the gap to either neighbour collapses to <= 1, the caller should
 *    full-renumber the post (`renumberPostBlocks`).
 */
export function computeInsertSeq(prev: number | undefined, next: number | undefined): number {
  if (prev === undefined && next === undefined) {
    return BLOCK_SEQ_STEP
  }
  if (next === undefined) {
    return (prev ?? 0) + BLOCK_SEQ_STEP
  }
  if (prev === undefined) {
    return Math.max(1, next - BLOCK_SEQ_STEP)
  }
  return Math.floor((prev + next) / 2)
}

/**
 * Returns true when the gap between two seq values is too small to safely
 * insert another block between them, meaning the caller should re-stripe.
 */
export function seqGapTooTight(prev: number | undefined, next: number | undefined): boolean {
  if (prev === undefined || next === undefined) {
    return false
  }
  return next - prev <= 1
}

/**
 * Reset all `has_blocks.seq` values for a post back to a clean 10/20/30...
 * stripe, preserving current order.
 */
export async function renumberPostBlocks(db: Surreal, postRecordId: string): Promise<BlockRecord[]> {
  const versionId = await ensureCurrentVersionForPost(db, postRecordId)
  const blocks = await loadBlocksForPost(db, postRecordId)

  if (!blocks.length) return blocks

  const stmts: string[] = []
  const params: Record<string, unknown> = { versionId }
  for (let i = 0; i < blocks.length; i += 1) {
    const block = blocks[i]!
    const seq = (i + 1) * BLOCK_SEQ_STEP
    const blockId = recordIdPart(block.id, 'block')
    params[`bid_${i}`] = blockId
    params[`seq_${i}`] = seq
    stmts.push(
      `UPDATE has_blocks SET seq = $seq_${i} WHERE in = type::record('versions', $versionId) AND out = type::record('block', $bid_${i});`
    )
    block.seq = seq
  }
  await queryDb(db, stmts.join('\n'), params, { label: `batch-renumber ${blocks.length} blocks` })

  return blocks
}

/**
 * Swap the seq numbers of two blocks (used by reorder when moving by one
 * position).
 */
export async function swapBlockSeq(db: Surreal, postRecordId: string, blockIdA: string, blockIdB: string) {
  const versionId = await ensureCurrentVersionForPost(db, postRecordId)
  const a = recordIdPart(blockIdA, 'block')
  const b = recordIdPart(blockIdB, 'block')

  const response = await queryDb(
    db,
    `SELECT out AS id, seq FROM has_blocks
     WHERE in = type::record('versions', $versionId)
       AND out IN [type::record('block', $a), type::record('block', $b)];`,
    { versionId, a, b }
  )
  const rows = queryRows<{ id: unknown, seq?: number }>(response, 0)
  const seqByBlock = new Map(rows.map((row) => [stringifyRecordId(row.id), Number(row.seq ?? 0)]))
  const seqA = seqByBlock.get(`block:${a}`)
  const seqB = seqByBlock.get(`block:${b}`)

  if (seqA === undefined || seqB === undefined) {
    throw createError({ statusCode: 404, message: 'Block not found on post' })
  }

  await queryDb(
    db,
    `UPDATE has_blocks SET seq = $seqB WHERE in = type::record('versions', $versionId) AND out = type::record('block', $a);
     UPDATE has_blocks SET seq = $seqA WHERE in = type::record('versions', $versionId) AND out = type::record('block', $b);`,
    { versionId, a, seqB, b, seqA },
    { label: 'batch-swap block seq' }
  )
}

/* ---------- Inter-post links ---------- */

export async function readPostRelated(db: Surreal, postRecordId: string): Promise<RelatedPostSummary[]> {
  const postId = recordIdPart(postRecordId, 'post')
  const response = await queryDb(
    db,
    `SELECT out.id AS id, out.slug AS slug, out.title AS title
     FROM links
     WHERE in = type::record('post', $postId)
       AND out.status != 'archived'
     ORDER BY out.title ASC;`,
    { postId }
  )

  return queryRows<Record<string, unknown>>(response).map((row) => ({
    id: stringifyRecordId(row.id),
    slug: String(row.slug ?? ''),
    title: String(row.title ?? '')
  })).filter((post) => post.id && post.slug && post.title)
}

export async function syncPostRelatedLinks(db: Surreal, postRecordId: string, relatedPostIds: unknown) {
  const postId = recordIdPart(postRecordId, 'post')
  const desiredIds = normalizeRelatedPostIds(relatedPostIds, postId)
  const currentIds = await readPostRelatedIds(db, postRecordId)

  const desiredSet = new Set(desiredIds)
  const currentSet = new Set(currentIds)
  const removedIds = currentIds.filter(id => !desiredSet.has(id))
  const addedIds = desiredIds.filter(id => !currentSet.has(id))

  const statements: string[] = []
  const params: Record<string, unknown> = { postId }

  for (let i = 0; i < removedIds.length; i++) {
    params[`rid_${i}`] = removedIds[i]
    statements.push(`DELETE links WHERE in = type::record('post', $postId) AND out = type::record('post', $rid_${i});`)
    statements.push(`DELETE links WHERE in = type::record('post', $rid_${i}) AND out = type::record('post', $postId);`)
  }

  for (let i = 0; i < addedIds.length; i++) {
    params[`aid_${i}`] = addedIds[i]
    statements.push(`RELATE (type::record('post', $postId)) -> links -> (type::record('post', $aid_${i}));`)
    statements.push(`RELATE (type::record('post', $aid_${i})) -> links -> (type::record('post', $postId));`)
  }

  if (statements.length) {
    await queryDb(db, statements.join('\n'), params, { label: `sync ${addedIds.length}/${removedIds.length} related links` })
  }

  return await readPostRelated(db, postRecordId)
}

async function readPostRelatedIds(db: Surreal, postRecordId: string) {
  const postId = recordIdPart(postRecordId, 'post')
  const response = await queryDb(
    db,
    `SELECT out FROM links
     WHERE in = type::record('post', $postId);`,
    { postId }
  )

  return queryRows<{ out?: unknown }>(response)
    .map((row) => recordIdPart(stringifyRecordId(row.out), 'post'))
    .filter(Boolean)
}

function normalizeRelatedPostIds(value: unknown, postId: string) {
  const items = Array.isArray(value) ? value : []
  const ids: string[] = []
  const seen = new Set<string>()

  for (const item of items) {
    const id = recordIdPart(String(item ?? ''), 'post')
    if (!id || id === postId || seen.has(id)) {
      continue
    }
    seen.add(id)
    ids.push(id)
  }

  return ids
}

