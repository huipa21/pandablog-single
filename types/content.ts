export interface JsonContent {
  type?: string
  attrs?: Record<string, unknown>
  text?: string
  marks?: Array<{
    type: string
    attrs?: Record<string, unknown>
  }>
  content?: JsonContent[]
}

export type PostStatus = 'draft' | 'published' | 'archived'
export type PostVisibility = 'public' | 'private' | 'password'

/**
 * Editor-facing block: a top-level Tiptap node that has been persisted
 * as a row in the `block` table and connected to a post via `has_blocks`.
 * The `blockId` attribute is mirrored onto the Tiptap node so the editor
 * can track stable identity across edits.
 */
export interface BlockRecord {
  id: string
  type: string
  node: JsonContent
  text: string
  seq: number
}

export interface PostRecord {
  id: string
  title: string
  slug: string
  summary?: string | null
  /** Reassembled Tiptap doc, built on the server from the post's blocks. */
  content_json: JsonContent
  /** Ordered blocks belonging to the post (with seq and stable id). */
  blocks?: BlockRecord[]
  status: PostStatus
  cover_image?: string | null
  published_at?: string | null
  created_at: string
  updated_at: string
  view_count: number
  word_count: number
  cjk_char_count: number
  has_versioning?: boolean
  visibility?: PostVisibility
  password_hint?: string | null
  tag_ids?: string[]
  category_ids?: string[]
  tags?: TagRecord[]
  categories?: CategoryRecord[]
  /** Slugs of posts linked from this post (via the `links` edge). */
  linked_post_slugs?: string[]
  related_post_ids?: string[]
  related_posts?: RelatedPostSummary[]
}

export interface RelatedPostSummary {
  id: string
  slug: string
  title: string
}

export interface PostListItem {
  id: string
  slug: string
  title: string
  summary?: string | null
  excerpt?: string | null
  cover_image?: string | null
  published_at?: string | null
  view_count?: number
  word_count?: number
  cjk_char_count?: number
  visibility?: PostVisibility
  categories?: Array<Pick<CategoryRecord, 'name' | 'slug'>>
}

export interface PostLockedResponse {
  locked: true
  slug: string
  title?: string | null
  visibility: 'password'
  passwordHint?: string | null
}

/** A single block match in a search result, with optional snippet highlight. */
export interface SearchBlockMatch {
  blockId: string
  type: string
  snippet: string
  score: number
}

export interface SearchPostResult {
  post: PostListItem
  score: number
  matches: SearchBlockMatch[]
  totalMatches: number
  /** `exact` results always rank above `fuzzy` (typo-tolerant) ones. */
  tier: SearchMatchTier
  status: PostStatus
  /** Password-protected post the viewer has not unlocked: title-only matching. */
  locked: boolean
}

export type SearchMatchTier = 'exact' | 'fuzzy'

export interface SearchResponse {
  /** Readable keyword expression (empty for filter-only searches). */
  query: string
  sort: SearchSort
  limit: number
  page: number
  pages: number
  total: number
  maxPerPost: number
  results: SearchPostResult[]
}

export interface SearchOptionTag {
  slug: string
  name: string
  count: number
}

export interface SearchOptionCategory {
  slug: string
  name: string
  /** Full path label, e.g. `Parent › Child`. */
  label: string
  parent: string | null
  /** Visible published posts in this category and its sub-categories. */
  count: number
}

export interface SearchOptionsResponse {
  tags: SearchOptionTag[]
  categories: SearchOptionCategory[]
}

export type SearchSort = 'relevance' | 'date_desc' | 'date_asc' | 'title'

// ============ MEDIA LIBRARY ============

export type MediaFileType = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other'

export interface MediaImageMeta {
  width?: number | null
  height?: number | null
  format?: string | null
  has_alpha?: boolean
  exif?: Record<string, unknown> | null
}

export type MediaVariantSize = 'thumbnail' | 'medium' | 'large'

export interface MediaVariantRecord {
  path: string
  url: string
  mime_type: string
  width?: number | null
  height?: number | null
  size?: number | null
}

export interface MediaFolderRecord {
  id: string
  name: string
  slug: string
  parent?: string | null
  created_at: string
  updated_at: string
}

export interface MediaTagSummary {
  id: string
  name: string
  slug: string
  count: number
  latest_uploaded_at?: string | null
}

export interface MediaRecord {
  metadata_truncated?: boolean
  storage_state?: string
  id: string
  original_name: string
  stored_name?: string
  extension: string
  mime_type: string
  size: number
  hash: string
  original_path?: string
  url: string
  variants?: Partial<Record<MediaVariantSize, MediaVariantRecord>>
  width?: number | null
  height?: number | null
  is_image?: boolean
  image_meta?: MediaImageMeta | null
  folders?: string[]
  tags?: string[]
  comment?: string | null
  reference_count?: number
  referenced_by?: string[]
  visibility?: 'public' | 'private'
  thumbnail_url?: string | null
  perceptual_hash?: string | null
  created_at: string
  uploaded_at?: string
  updated_at?: string
}

export type UploadResultStatus = 'created' | 'duplicate' | 'similar' | 'rejected'

export interface UploadFileResult {
  original_name?: string
  extension?: string
  status: UploadResultStatus
  reason?: string
  record?: MediaRecord
  similar_to?: MediaRecord
}

export interface CategoryRecord {
  id: string
  name: string
  slug: string
  description?: string | null
  parent_id?: string | null
  post_count?: number
}

export interface TagRecord {
  id: string
  name: string
  slug: string
  post_count?: number
  media_count?: number
}