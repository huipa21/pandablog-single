import type { MediaFileType, MediaFolderRecord, MediaRecord, MediaTagSummary, UploadFileResult } from '~/types/content'

interface MediaListResponse {
  search_truncated?: boolean
  files: MediaRecord[]
  total: number
  page: number
  limit: number
  pages: number
}

interface UploadResponse {
  results: UploadFileResult[]
}

interface MediaListOptions {
  page?: number
  limit?: number
  search?: string
  file_name?: string
  extension?: string
  comment?: string
  tags?: string[]
  tag_relation?: 'and' | 'or'
  filename_regex?: string
  filename_regex_case_insensitive?: boolean
  search_regex?: boolean
  case_insensitive?: boolean
  sort?: string
  type?: 'all' | MediaFileType
  folder?: string
  tag?: string
  mime_type?: string
  uploaded_from?: string
  uploaded_to?: string
  orphan?: boolean
  visibility?: 'all' | 'public' | 'private'
  size_min?: number
  size_max?: number
}

interface UploadOptions {
  visibility?: 'public' | 'private'
}

export function useMedia() {
  async function listMedia(options: MediaListOptions = {}) {
    const query = new URLSearchParams()
    query.set('page', String(options.page || 1))
    query.set('limit', String(options.limit || 24))
    if (options.search) query.set('search', options.search)
    if (options.file_name) query.set('file_name', options.file_name)
    if (options.extension) query.set('extension', options.extension)
    if (options.comment) query.set('comment', options.comment)
    if (options.tags?.length) query.set('tags', JSON.stringify(options.tags))
    if (options.tag_relation && options.tag_relation !== 'and') query.set('tag_relation', options.tag_relation)
    if (options.filename_regex) query.set('filename_regex', options.filename_regex)
    if (options.filename_regex_case_insensitive !== undefined) query.set('filename_regex_case_insensitive', String(options.filename_regex_case_insensitive))
    if (options.search_regex) query.set('search_regex', 'true')
    if (options.case_insensitive !== undefined) query.set('case_insensitive', String(options.case_insensitive))
    if (options.sort) query.set('sort', options.sort)
    if (options.type && options.type !== 'all') query.set('type', options.type)
    if (options.folder) query.set('folder', options.folder)
    if (options.tag) query.set('tag', options.tag)
    if (options.mime_type) query.set('mime_type', options.mime_type)
    if (options.uploaded_from) query.set('uploaded_from', options.uploaded_from)
    if (options.uploaded_to) query.set('uploaded_to', options.uploaded_to)
    if (options.orphan) query.set('orphan', 'true')
    if (options.visibility && options.visibility !== 'all') query.set('visibility', options.visibility)
    if (options.size_min && options.size_min > 0) query.set('size_min', String(Math.floor(options.size_min)))
    if (options.size_max && options.size_max > 0) query.set('size_max', String(Math.floor(options.size_max)))

    return await $fetch<MediaListResponse>(`/api/media/search?${query}`)
  }

  async function uploadFiles(files: File[], onProgress?: (file: File, progress: number) => void, options: UploadOptions = {}) {
    if (!import.meta.client) {
      const formData = new FormData()
      for (const file of files) {
        formData.append('files', file)
      }
      formData.append('visibility', options.visibility === 'private' ? 'private' : 'public')
      return await $fetch<UploadResponse>('/api/media/upload', {
        method: 'POST',
        body: formData
      })
    }

    const responses = await Promise.all(files.map((file) => uploadSingleFile(file, onProgress, options)))
    return {
      results: responses.flatMap((response) => response.results)
    }
  }

  async function getMedia(id: string) {
    return await $fetch<MediaRecord>(`/api/media/${encodeURIComponent(mediaHashFromId(id))}`)
  }

  async function updateMedia(id: string, body: Partial<Pick<MediaRecord, 'original_name' | 'comment' | 'tags' | 'folders'>>) {
    return await $fetch<MediaRecord>(`/api/media/${encodeURIComponent(mediaHashFromId(id))}`, {
      method: 'PATCH',
      body
    })
  }

  async function deleteMedia(id: string, force = false) {
    const query = force ? '?force=true' : ''
    return await $fetch(`/api/media/${encodeURIComponent(mediaHashFromId(id))}${query}`, {
      method: 'DELETE'
    })
  }

  async function listFolders() {
    return await $fetch<{ folders: MediaFolderRecord[], truncated?: boolean }>('/api/media/folders')
  }

  async function listMediaTags(query?: string) {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    return await $fetch<{ tags: MediaTagSummary[], truncated?: boolean }>(`/api/media/tags?${params}`)
  }

  async function createFolder(name: string, parent?: string | null) {
    return await $fetch<MediaFolderRecord>('/api/media/folders', {
      method: 'POST',
      body: { name, parent }
    })
  }

  async function updateFolder(id: string, body: Partial<Pick<MediaFolderRecord, 'name' | 'parent'>>) {
    return await $fetch<MediaFolderRecord>(`/api/media/folders/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body
    })
  }

  async function deleteFolder(id: string) {
    return await $fetch(`/api/media/folders/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })
  }

  async function cleanupOrphans(options: { older_than_days?: number, hashes?: string[] } = {}) {
    return await $fetch<{ deleted_count: number, failed_count: number, incomplete: boolean }>('/api/media/orphans/cleanup', {
      method: 'POST',
      body: options
    })
  }

  async function importFromUrl(url: string) {
    return await $fetch<MediaRecord>('/api/admin/media/import-from-url', {
      method: 'POST',
      body: { url }
    })
  }

  function getFileUrl(id: string) {
    return `/media/${encodeURIComponent(mediaHashFromId(id))}`
  }

  function getThumbnailUrl(id: string) {
    return `/media/${encodeURIComponent(mediaHashFromId(id))}?variant=thumbnail`
  }

  function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1)
    return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`
  }

  function getFileType(extension: string, mimeType = ''): MediaFileType {
    const ext = extension.toLowerCase()
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg'].includes(ext) || mimeType.startsWith('image/')) return 'image'
    if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(ext) || mimeType.startsWith('video/')) return 'video'
    if (['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'oga'].includes(ext) || mimeType.startsWith('audio/')) return 'audio'
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'md'].includes(ext)) return 'document'
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive'
    return 'other'
  }

  function getFileIcon(extension: string, mimeType = ''): string {
    const ext = extension.toLowerCase()
    const mime = mimeType.toLowerCase()
    if (['doc', 'docx'].includes(ext) || mime.includes('wordprocessingml') || mime === 'application/msword') return 'i-lucide-file-text'
    if (['xls', 'xlsx', 'csv'].includes(ext) || mime.includes('spreadsheetml') || mime === 'application/vnd.ms-excel') return 'i-lucide-file-spreadsheet'
    if (['ppt', 'pptx'].includes(ext) || mime.includes('presentationml') || mime === 'application/vnd.ms-powerpoint') return 'i-lucide-presentation'
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'i-lucide-file-archive'

    const type = getFileType(extension, mimeType)
    const iconMap: Record<MediaFileType, string> = {
      image: 'i-lucide-image',
      video: 'i-lucide-film',
      audio: 'i-lucide-audio-lines',
      document: 'i-lucide-file-text',
      archive: 'i-lucide-file-archive',
      other: 'i-lucide-file'
    }
    return iconMap[type]
  }

  return {
    listMedia,
    uploadFiles,
    importFromUrl,
    getMedia,
    updateMedia,
    deleteMedia,
    listFolders,
    listMediaTags,
    createFolder,
    updateFolder,
    deleteFolder,
    cleanupOrphans,
    getFileUrl,
    getThumbnailUrl,
    formatFileSize,
    getFileType,
    getFileIcon
  }
}

function uploadSingleFile(file: File, onProgress?: (file: File, progress: number) => void, options: UploadOptions = {}) {
  return new Promise<UploadResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const formData = new FormData()
    formData.append('files', file)
    formData.append('visibility', options.visibility === 'private' ? 'private' : 'public')

    xhr.open('POST', '/api/media/upload')
    xhr.withCredentials = true
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress?.(file, Math.round((event.loaded / event.total) * 100))
      }
    })
    xhr.addEventListener('load', () => {
      const responseText = xhr.responseText || '{}'

      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(file, 100)
        resolve(JSON.parse(responseText) as UploadResponse)
        return
      }

      reject(new Error(parseFetchError(responseText) || `Upload failed (${xhr.status})`))
    })
    xhr.addEventListener('error', () => reject(new Error('Upload failed')))
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))
    xhr.send(formData)
  })
}

function parseFetchError(responseText: string) {
  try {
    const parsed = JSON.parse(responseText) as { message?: string, statusMessage?: string }
    return parsed.statusMessage || parsed.message || ''
  } catch {
    return ''
  }
}

function mediaHashFromId(id: string) {
  const decoded = decodeURIComponent(id)
  return decoded.startsWith('files:') ? decoded.slice('files:'.length) : decoded
}
