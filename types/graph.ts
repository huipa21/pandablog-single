export type GraphNodeType = 'post' | 'category' | 'tag'
export type GraphEdgeType = 'link' | 'categorized' | 'tagged' | 'cooccurs'
export type GraphViewerScope = 'anonymous' | 'owner'
export type GraphPostVisibility = 'public' | 'private'

export interface GraphPostNode {
  id: string
  type: 'post'
  slug: string
  title: string
  degree: number
  category: string | null
  visibility: GraphPostVisibility
}

export interface GraphTaxonomyNode {
  id: string
  type: 'category' | 'tag'
  slug: string
  name: string
  postCount: number | null
}

export type GraphNode = GraphPostNode | GraphTaxonomyNode

export interface GraphEdge {
  id: string
  source: string
  target: string
  type: GraphEdgeType
}

export interface GraphClusterAggregate {
  id: string
  type: 'category' | 'tag'
  slug: string
  name: string
  postCount: number
  heatWeight: number
}

export interface GraphOverviewResponse {
  clusters: GraphClusterAggregate[]
  nodes: GraphNode[]
  edges: GraphEdge[]
  totalPosts: number
  viewerScope: GraphViewerScope
  generatedAt: string
}

export interface GraphClusterResponse {
  category: {
    id: string
    slug: string
    name: string
  }
  nodes: GraphPostNode[]
  edges: GraphEdge[]
  truncated: boolean
  limit: number
  viewerScope: GraphViewerScope
}

export interface GraphTagResponse {
  tag: {
    id: string
    slug: string
    name: string
  }
  nodes: GraphPostNode[]
  edges: GraphEdge[]
  truncated: boolean
  limit: number
  viewerScope: GraphViewerScope
}

export interface GraphPostResponse {
  focus: string
  cluster: string | null
  nodes: GraphNode[]
  edges: GraphEdge[]
  viewerScope: GraphViewerScope
}