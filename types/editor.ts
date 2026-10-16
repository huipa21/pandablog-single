import type { JsonContent, PostVisibility, RelatedPostSummary } from './content'

export interface AdminPostEditorForm {
  title: string
  slug: string
  summary: string
  cover_image: string
  category_ids: string[]
  tag_ids: string[]
  category_names: string[]
  tag_names: string[]
  visibility: PostVisibility
  password: string
  password_hint: string
  related_post_ids: string[]
  related_posts: RelatedPostSummary[]
  content: JsonContent
}

export interface PostVersionListItem {
  id: string
  version: string
  datetime: string
  diff: Array<Record<string, unknown>>
}