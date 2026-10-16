<template>
  <section class="space-y-5">
    <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <h1 class="text-3xl font-semibold tracking-normal text-[var(--pb-text)]">{{ t('admin.media.title') }}</h1>
        <p class="text-sm text-[var(--pb-text-subtle)]">{{ t('admin.media.fileCount', { count: total }) }}</p>
      </div>
      <div class="flex items-center gap-2">
        <UButton type="button" icon="i-lucide-upload" @click="uploadModalOpen = true">{{ t('admin.media.uploadFiles') }}</UButton>
        <UButton type="button" icon="i-lucide-search" color="neutral" variant="soft" @click="searchModalOpen = true">{{ t('admin.media.search') }}</UButton>
        <div class="flex rounded-[var(--pb-radius-md)] border border-[var(--pb-divider)]">
          <button
            type="button"
            class="rounded-l-[var(--pb-radius-md)] px-2 py-1.5 text-[var(--pb-text-muted)] transition hover:bg-[var(--pb-card-bg-hover)]"
            :class="viewMode === 'grid' ? 'bg-[var(--pb-selected-bg)] text-[var(--pb-text)]' : ''"
            @click="setViewMode('grid')"
          >
            <UIcon name="i-lucide-grid-2x2" class="size-4" />
          </button>
          <button
            type="button"
            class="rounded-r-[var(--pb-radius-md)] px-2 py-1.5 text-[var(--pb-text-muted)] transition hover:bg-[var(--pb-card-bg-hover)]"
            :class="viewMode === 'list' ? 'bg-[var(--pb-selected-bg)] text-[var(--pb-text)]' : ''"
            @click="setViewMode('list')"
          >
            <UIcon name="i-lucide-list" class="size-4" />
          </button>
        </div>
        <UButton icon="i-lucide-settings" to="/admin/settings/media" color="neutral" variant="soft">{{ t('admin.media.settings') }}</UButton>
      </div>
    </div>

    <div class="grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <MediaFolderTree
        :folders="folders"
        :media-tags="mediaTags"
        :smart-folders="smartFolders"
        :mode="mode"
        :selected-folder="selectedFolder"
        :selected-smart-folder="selectedSmartFolder"
        @select-all="selectAll"
        @select-folder="selectFolder"
        @select-tags-view="selectTagsView"
        @select-smart-folder="selectSmartFolderById"
        @create-folder="openFolderModal"
        @rename-folder="handleRenameFolder"
        @delete-folder="handleDeleteFolder"
        @assign-file="assignFileToFolder"
        @create-smart-folder="openSmartFolderModal()"
        @edit-smart-folder="openSmartFolderModal($event)"
        @delete-smart-folder="handleDeleteSmartFolder"
      />

      <div class="min-w-0 space-y-5">
        <!-- Active filters indicator -->
        <div v-if="hasActiveFilters && mode !== 'smart'" class="flex flex-wrap items-center gap-2 rounded-[var(--pb-radius-card-inner)] border border-amber-300/50 bg-amber-500/10 p-3">
          <UIcon name="i-lucide-filter" class="size-4 text-amber-700" />
          <span class="text-sm font-medium text-amber-800">{{ t('admin.media.activeFilters') }}</span>
          <span v-if="filters.search" class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{{ t('admin.media.filterSearch', { value: filters.search }) }}</span>
          <span v-if="filters.file_name" class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{{ t('admin.media.filterName', { value: filters.file_name }) }}</span>
          <span v-if="filters.extension" class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{{ t('admin.media.filterExt', { value: filters.extension }) }}</span>
          <span v-if="filters.comment" class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{{ t('admin.media.filterComment', { value: filters.comment }) }}</span>
          <span v-if="filters.tags.length" class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{{ t('admin.media.filterTags', { relation: filters.tags.length > 1 ? ` (${selectedTagRelationLabel})` : '', value: filters.tags.join(', ') }) }}</span>
          <span v-if="filters.type && filters.type !== 'all'" class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{{ t('admin.media.filterType', { value: filters.type }) }}</span>
          <span v-if="filters.uploaded_from || filters.uploaded_to" class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{{ t('admin.media.dateRange') }}</span>
          <span v-if="filters.size_min || filters.size_max" class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{{ t('admin.media.filterSize', { value: `${filters.size_min || '0'}–${filters.size_max || '∞'} ${filters.size_unit}` }) }}</span>
          <span v-if="filters.orphan" class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{{ t('admin.media.orphanOnly') }}</span>
          <UButton type="button" icon="i-lucide-x" size="xs" color="warning" variant="soft" class="ml-auto" @click="clearFilters">{{ t('admin.media.clearFilters') }}</UButton>
        </div>

        <!-- Tags view -->
        <div v-if="mode === 'tag'" class="space-y-4 rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] p-5">
          <div class="flex items-center gap-3">
            <h2 class="text-lg font-semibold text-[var(--pb-text)]">{{ t('admin.media.tags') }}</h2>
            <UInput v-model="tagSearch" size="sm" icon="i-lucide-search" :placeholder="t('admin.media.searchTags')" class="max-w-xs" />
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <div v-if="selectedMediaTags.length" class="flex items-center gap-2 rounded-[var(--pb-radius-md)] border border-[var(--pb-divider)] bg-[var(--pb-surface-subtle)] p-1">
              <span class="px-2 text-xs font-medium uppercase tracking-wide text-[var(--pb-text-subtle)]">{{ t('admin.media.match') }}</span>
              <button
                type="button"
                class="rounded-md px-2.5 py-1 text-xs font-semibold transition"
                :class="selectedTagRelation === 'and' ? 'bg-[var(--pb-card-bg)] text-[var(--pb-text)] shadow-[var(--pb-shadow-sm)]' : 'text-[var(--pb-text-subtle)] hover:text-[var(--pb-text)]'"
                @click="setSelectedTagRelation('and')"
              >
                AND
              </button>
              <button
                type="button"
                class="rounded-md px-2.5 py-1 text-xs font-semibold transition"
                :class="selectedTagRelation === 'or' ? 'bg-[var(--pb-card-bg)] text-[var(--pb-text)] shadow-[var(--pb-shadow-sm)]' : 'text-[var(--pb-text-subtle)] hover:text-[var(--pb-text)]'"
                @click="setSelectedTagRelation('or')"
              >
                OR
              </button>
            </div>
            <UButton v-if="selectedMediaTags.length" type="button" icon="i-lucide-x" size="xs" color="neutral" variant="soft" @click="clearTagSelection">{{ t('admin.media.clearSelection') }}</UButton>
            <p class="text-sm text-[var(--pb-text-subtle)]">
              <template v-if="selectedMediaTags.length">{{ t('admin.media.tagsSelected', { count: selectedMediaTags.length }) }}</template>
              <template v-else>{{ t('admin.media.selectTagsHint') }}</template>
            </p>
          </div>
          <div v-if="visibleMediaTags.length" class="flex flex-wrap gap-2">
            <button
              v-for="tag in visibleMediaTags"
              :key="tag.id"
              type="button"
              class="rounded-full px-3 py-1.5 font-medium transition hover:-translate-y-0.5 hover:bg-[var(--pb-selected-bg)] hover:text-[var(--pb-link-hover)]"
              :class="isMediaTagSelected(tag.name) ? 'bg-[var(--pb-selected-bg)] text-[var(--pb-text)] ring-1 ring-[var(--pb-selected-border)]' : 'bg-[var(--pb-surface-subtle)] text-[var(--pb-text-muted)]'"
              :style="tagStyle(tag.count)"
              @click="toggleMediaTag(tag.name)"
            >
              #{{ tag.name }}
              <span class="ml-1 text-[var(--pb-text-subtle)]">{{ tag.count }}</span>
            </button>
          </div>
          <p v-else class="text-sm text-[var(--pb-text-subtle)]">{{ t('admin.media.noTagsFound') }}</p>
        </div>

        <!-- File grid toolbar -->
        <div v-if="mode !== 'tag' || selectedMediaTags.length" class="flex flex-wrap items-center gap-2 rounded-[var(--pb-radius-card-inner)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] p-3">
          <UButton type="button" icon="i-lucide-check-check" color="neutral" variant="soft" @click="selectAllFiles">{{ t('admin.media.selectAll') }}</UButton>
          <UButton type="button" icon="i-lucide-eraser" color="neutral" variant="ghost" :disabled="selectedHashes.size === 0" @click="clearSelection">{{ t('admin.media.clear') }}</UButton>
          <UDropdownMenu :items="bulkActionItems">
            <UButton type="button" icon="i-lucide-more-horizontal" color="neutral" variant="soft" :disabled="selectedHashes.size === 0">
              {{ t('admin.media.actions') }}<template v-if="selectedHashes.size"> ({{ selectedHashes.size }})</template>
            </UButton>
          </UDropdownMenu>
          <UButton v-if="filters.orphan" type="button" icon="i-lucide-trash-2" color="error" variant="soft" :disabled="selectedHashes.size === 0" @click="openOrphanCleanupDialog">
            {{ t('admin.media.deleteOrphans') }}<template v-if="selectedHashes.size"> ({{ selectedHashes.size }})</template>
          </UButton>
          <div class="ml-auto flex flex-wrap items-center gap-2">
            <div class="text-sm text-[var(--pb-text-subtle)]">{{ t('admin.media.pageOf', { page, pages }) }}</div>
            <UButton type="button" icon="i-lucide-chevron-left" color="neutral" variant="ghost" :disabled="page <= 1" @click="changePage(page - 1)" />
            <UButton type="button" icon="i-lucide-chevron-right" color="neutral" variant="ghost" :disabled="page >= pages" @click="changePage(page + 1)" />
            <div class="w-44">
              <USelect :model-value="sortBy" :items="sortItems" @update:model-value="changeSort(String($event))" />
            </div>
            <div class="w-32">
              <USelect :model-value="String(itemsPerPage)" :items="pageSizeItems" @update:model-value="changePageSize(String($event))" />
            </div>
          </div>
        </div>

        <UAlert v-if="files.some(file => file.metadata_truncated)" color="warning" :title="t('admin.media.metadataTruncated')" class="mb-3" />
        <UAlert v-if="facetsTruncated" color="warning" :title="t('admin.media.facetsTruncated')" class="mb-3" />
        <UAlert v-if="searchTruncated" color="warning" :title="t('admin.media.searchTruncated')" class="mb-3" />
        <template v-if="mode !== 'tag' || selectedMediaTags.length">
          <div v-if="loading" class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            <USkeleton v-for="index in 10" :key="index" class="aspect-square rounded-lg" />
          </div>

          <div v-else-if="error" class="rounded-[var(--pb-radius-card-outer)] border border-dashed border-red-300 bg-red-50/60 py-14 text-center">
            <UIcon name="i-lucide-triangle-alert" class="mx-auto mb-2 size-10 text-red-500" />
            <p class="text-sm text-red-900">{{ error }}</p>
            <UButton type="button" size="xs" color="neutral" variant="soft" icon="i-lucide-rotate-ccw" class="mt-3" @click="loadMedia">{{ t('admin.media.retry') }}</UButton>
          </div>

          <div v-else-if="!files.length" class="rounded-[var(--pb-radius-card-outer)] border border-dashed border-[var(--pb-border-strong)] bg-[var(--pb-card-bg)] py-14 text-center">
            <UIcon name="i-lucide-inbox" class="mx-auto mb-2 size-10 text-[var(--pb-icon-muted)]" />
            <p class="text-sm text-[var(--pb-text-muted)]">{{ t('admin.media.noMediaFiles') }}</p>
          </div>

          <MediaGrid
            v-else
            :files="files"
            :page="page"
            :pages="pages"
            :selected-hashes="[...selectedHashes]"
            :view-mode="viewMode"
            :show-pagination="false"
            @select="handleItemClick"
            @toggle-select="toggleSelection($event.hash)"
            @range-select="selectRangeTo($event.hash)"
            @drag-select="addDragSelection"
            @change-page="changePage"
          />
        </template>
      </div>
    </div>

    <MediaDetailPanel
      :file="selectedMedia"
      :folders="folders"
      @close="closeDetailPanel"
      @updated="handleFileUpdated"
      @deleted="handleFileDeleted"
    />

    <MediaSmartFolderModal
      v-if="smartFolderModalOpen"
      :folder="editingSmartFolder"
      @close="smartFolderModalOpen = false"
      @saved="handleSmartFolderSaved"
    />

    <MediaFolderModal
      v-if="folderModalOpen"
      @close="folderModalOpen = false"
      @create="handleCreateFolder"
    />

    <Teleport to="body">
      <div v-if="uploadModalOpen" class="fixed inset-0 z-50 flex items-center justify-center p-4">
        <button type="button" class="absolute inset-0 bg-black/40" :aria-label="t('admin.common.close')" @click="uploadModalOpen = false" />
        <section class="relative flex max-h-[92vh] w-full max-w-5xl flex-col rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] shadow-[var(--pb-shadow-lg)]">
          <header class="flex items-center justify-between border-b border-[var(--pb-divider)] p-4">
            <h2 class="text-lg font-semibold text-[var(--pb-text)]">{{ t('admin.media.uploadFiles') }}</h2>
            <UButton type="button" icon="i-lucide-x" color="neutral" variant="ghost" @click="uploadModalOpen = false" />
          </header>
          <div class="min-h-0 flex-1 overflow-y-auto p-4">
            <MediaUploader @upload-complete="handleUploadComplete" @view-media="openById" />
          </div>
        </section>
      </div>
    </Teleport>

    <MediaSearchModal
      v-if="searchModalOpen"
      :model-value="searchPayload"
      @close="searchModalOpen = false"
      @apply="handleAdvancedSearch"
    />

    <AdminPromptDialog
      :open="bulkTagsDialogOpen"
      :title="t('admin.media.editTags')"
      :description="bulkTagsDialogDescription"
      :label="t('admin.media.tags')"
      :placeholder="t('admin.media.bulkTagsPlaceholder')"
      :confirm-label="t('admin.media.updateTags')"
      :required="false"
      @update:open="(value) => { if (!value) bulkTagsDialogOpen = false }"
      @cancel="bulkTagsDialogOpen = false"
      @confirm="confirmBulkTags"
    />

    <AdminPromptDialog
      :open="bulkCommentDialogOpen"
      :title="t('admin.media.editComment')"
      :description="bulkCommentDialogDescription"
      :label="t('admin.media.comment')"
      :placeholder="t('admin.media.bulkCommentPlaceholder')"
      :confirm-label="t('admin.media.updateComment')"
      :required="false"
      :trim="false"
      multiline
      :rows="3"
      @update:open="(value) => { if (!value) bulkCommentDialogOpen = false }"
      @cancel="bulkCommentDialogOpen = false"
      @confirm="confirmBulkComment"
    />

    <AdminSelectDialog
      :open="bulkAssignFolderDialogOpen"
      :title="t('admin.media.assignFolder')"
      :description="bulkAssignFolderDialogDescription"
      :label="t('admin.media.folders')"
      :placeholder="t('admin.media.chooseFolder')"
      :items="folderSelectItems"
      :initial-value="bulkAssignFolderInitialValue"
      :confirm-label="t('admin.media.assignFolder')"
      @update:open="(value) => { if (!value) bulkAssignFolderDialogOpen = false }"
      @cancel="bulkAssignFolderDialogOpen = false"
      @confirm="confirmBulkAssignFolder"
    />

    <AdminConfirmActionDialog
      :open="bulkDeleteDialogOpen"
      :title="t('admin.media.bulkDeleteTitle')"
      :description="bulkDeleteDialogDescription"
      :confirm-label="t('admin.media.deleteFiles')"
      confirm-color="error"
      :loading="bulkDeletePending"
      @update:open="(value) => { if (!value) closeBulkDeleteDialog() }"
      @cancel="closeBulkDeleteDialog"
      @confirm="confirmBulkDelete"
    />

    <AdminConfirmActionDialog
      :open="orphanCleanupDialogOpen"
      :title="t('admin.media.deleteOrphansTitle')"
      :description="orphanCleanupDialogDescription"
      :confirm-label="t('admin.media.deleteOrphans')"
      confirm-color="error"
      :loading="orphanCleanupPending"
      @update:open="(value) => { if (!value) closeOrphanCleanupDialog() }"
      @cancel="closeOrphanCleanupDialog"
      @confirm="confirmOrphanCleanup"
    />

    <AdminConfirmActionDialog
      :open="smartFolderDeleteDialogOpen"
      :title="t('admin.media.deleteSmartFolderTitle')"
      :description="smartFolderDeleteDialogDescription"
      :confirm-label="t('admin.media.delete')"
      confirm-color="error"
      :loading="smartFolderDeletePending"
      @update:open="(value) => { if (!value) closeSmartFolderDeleteDialog() }"
      @cancel="closeSmartFolderDeleteDialog"
      @confirm="confirmDeleteSmartFolder"
    />
  </section>
</template>

<script setup lang="ts">
import type { MediaFolderRecord, MediaRecord, MediaTagSummary } from '~/types/content'
import MediaDetailPanel from '~/components/admin/media/MediaDetailPanel.vue'
import MediaFolderTree from '~/components/admin/media/MediaFolderTree.vue'
import MediaGrid from '~/components/admin/media/MediaGrid.vue'
import MediaUploader from '~/components/admin/media/MediaUploader.vue'
import MediaSmartFolderModal from '~/components/admin/media/MediaSmartFolderModal.vue'
import MediaSearchModal from '~/components/admin/media/MediaSearchModal.vue'
import MediaFolderModal from '~/components/admin/media/MediaFolderModal.vue'

interface MediaFilters {
  search: string
  file_name: string
  extension: string
  comment: string
  tags: string[]
  type: string
  tag: string
  uploaded_from: string
  uploaded_to: string
  orphan: boolean
  search_regex: boolean
  case_insensitive: boolean
  filename_regex: string
  filename_regex_case_insensitive: boolean
  size_min: string
  size_max: string
  size_unit: 'KB' | 'MB' | 'GB'
}

interface SmartFolder {
  id: string
  name: string
  filters: {
    tags?: string[]
    filename_regex?: string
    filename_regex_case_insensitive?: boolean
    file_type?: string
    date_from?: string
    date_to?: string
    orphan_only?: boolean
  }
}

const {
  listMedia,
  getMedia,
  updateMedia,
  deleteMedia,
  listFolders,
  listMediaTags,
  createFolder,
  updateFolder,
  deleteFolder,
  cleanupOrphans
} = useMedia()

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const files = ref<MediaRecord[]>([])
const folders = ref<MediaFolderRecord[]>([])
const mediaTags = ref<MediaTagSummary[]>([])
const smartFolders = ref<SmartFolder[]>([])
const selectedMedia = ref<MediaRecord | null>(null)
const selectedHashes = ref<Set<string>>(new Set())
const lastSelectedHash = ref('')
const loading = ref(true)
const total = ref(0)
const page = ref(1)
const pages = ref(1)
const mode = ref<'all' | 'folder' | 'smart' | 'tag'>('all')
const selectedFolder = ref('')
const selectedMediaTags = ref<string[]>([])
const selectedTagRelation = ref<'and' | 'or'>('and')
const selectedSmartFolder = ref('')
const error = ref('')
const searchTruncated = ref(false)
const facetsTruncated = ref(false)
const adminToast = useAdminToast()
const viewMode = ref<'grid' | 'list'>((typeof localStorage !== 'undefined' && localStorage.getItem('media-view-mode') as 'grid' | 'list') || 'grid')
const itemsPerPage = ref(25)
const sortBy = ref('uploaded_at_desc')
let syncingMediaRoute = false
const uploadModalOpen = ref(false)
const searchModalOpen = ref(false)
const smartFolderModalOpen = ref(false)
const editingSmartFolder = ref<SmartFolder | null>(null)
const folderModalOpen = ref(false)
const bulkTagsDialogOpen = ref(false)
const bulkCommentDialogOpen = ref(false)
const bulkAssignFolderDialogOpen = ref(false)
const bulkDeleteDialogOpen = ref(false)
const bulkDeletePending = ref(false)
const orphanCleanupDialogOpen = ref(false)
const orphanCleanupPending = ref(false)
const smartFolderDeleteDialogOpen = ref(false)
const smartFolderDeletePending = ref(false)
const pendingDeleteSmartFolderId = ref('')
const selectedFileCountLabel = computed(() => t('admin.media.selectedFiles', { count: selectedHashes.value.size }))
const bulkTagsDialogDescription = computed(() => t('admin.media.bulkTagsDescription', { count: selectedFileCountLabel.value }))
const bulkCommentDialogDescription = computed(() => t('admin.media.bulkCommentDescription', { count: selectedFileCountLabel.value }))
const bulkAssignFolderDialogDescription = computed(() => t('admin.media.bulkAssignDescription', { count: selectedFileCountLabel.value }))
const bulkDeleteDialogDescription = computed(() => t('admin.media.bulkDeleteDescription', { count: selectedHashes.value.size }))
const orphanCleanupDialogDescription = computed(() => t('admin.media.deleteOrphansDescription', { count: selectedHashes.value.size }))
const smartFolderDeleteDialogDescription = computed(() => {
  const folder = smartFolders.value.find((item) => item.id === pendingDeleteSmartFolderId.value)
  return folder ? t('admin.media.deleteSmartFolderDescription', { name: folder.name }) : t('admin.media.deleteSmartFolderFallback')
})
const folderSelectItems = computed(() => folders.value.map((folder) => ({
  label: folder.name,
  value: folder.id
})))
const bulkAssignFolderInitialValue = computed(() => selectedFolder.value || folders.value.find((folder) => folder.slug === 'default')?.id || folders.value[0]?.id || '')

const filters = ref<MediaFilters>({
  search: '',
  file_name: '',
  extension: '',
  comment: '',
  tags: [],
  type: 'all',
  tag: '',
  uploaded_from: '',
  uploaded_to: '',
  orphan: false,
  search_regex: false,
  case_insensitive: true,
  filename_regex: '',
  filename_regex_case_insensitive: true,
  size_min: '',
  size_max: '',
  size_unit: 'KB'
})

const searchPayload = computed(() => filters.value)

const hasActiveFilters = computed(() => {
  const f = filters.value
  return !!(f.file_name || f.extension || f.comment || f.tags.length || (f.type && f.type !== 'all') || f.uploaded_from || f.uploaded_to || f.size_min || f.size_max || f.orphan || f.filename_regex || f.search)
})

const selectedTagRelationLabel = computed(() => selectedTagRelation.value.toUpperCase())

const bulkActionItems = computed(() => {
  const disabled = selectedHashes.value.size === 0
  return [
    [
      { label: t('admin.media.editTags'), icon: 'i-lucide-tags', disabled, onSelect: promptBulkTags },
      { label: t('admin.media.editComment'), icon: 'i-lucide-message-square', disabled, onSelect: promptBulkComment }
    ],
    [
      { label: t('admin.media.assignFolder'), icon: 'i-lucide-folder-symlink', disabled, onSelect: promptBulkAssignFolder }
    ],
    [
      { label: t('admin.media.download'), icon: 'i-lucide-download', disabled, onSelect: handleBulkDownload }
    ],
    [
      { label: t('admin.media.deleteSelected'), icon: 'i-lucide-trash-2', color: 'error' as const, disabled, onSelect: openBulkDeleteDialog }
    ]
  ]
})

const sortItems = computed(() => [
  { label: t('admin.media.newestFirst'), value: 'uploaded_at_desc' },
  { label: t('admin.media.oldestFirst'), value: 'uploaded_at_asc' },
  { label: t('admin.media.nameAsc'), value: 'name_asc' },
  { label: t('admin.media.nameDesc'), value: 'name_desc' },
  { label: t('admin.media.sizeAsc'), value: 'size_asc' },
  { label: t('admin.media.sizeDesc'), value: 'size_desc' }
])

const pageSizeItems = computed(() => [
  { label: t('admin.media.perPage', { count: 25 }), value: '25' },
  { label: t('admin.media.perPage', { count: 50 }), value: '50' },
  { label: t('admin.media.perPage', { count: 100 }), value: '100' }
])

function setViewMode(mode: 'grid' | 'list') {
  viewMode.value = mode
  if (typeof localStorage !== 'undefined') localStorage.setItem('media-view-mode', mode)
}

const tagSearch = ref('')
const maxTagCount = computed(() => Math.max(1, ...mediaTags.value.map((tag) => tag.count)))
const visibleMediaTags = computed(() => {
  const query = tagSearch.value.trim().toLowerCase()
  return mediaTags.value
    .filter((tag) => !query || tag.name.toLowerCase().includes(query))
    .slice(0, 50)
})

function tagStyle(count: number) {
  const weight = Math.max(0, Math.min(1, count / maxTagCount.value))
  return {
    fontSize: `${0.75 + weight * 0.5}rem`,
    lineHeight: '1.2'
  }
}

onMounted(async () => {
  applyRouteFilters()
  await Promise.all([loadFolders(), loadMedia(), loadSmartFolders(), loadMediaTags()])
  await ensureInitialMediaDetailHistory()
  await openRouteMediaFile()
})

watch(() => route.query.file, () => {
  if (syncingMediaRoute) return
  void openRouteMediaFile()
})

watch(() => route.query.upload, (value) => {
  if (value !== '1') return

  uploadModalOpen.value = true
  const query = { ...route.query }
  delete query.upload
  void router.replace({ query })
}, { immediate: true })

async function loadMedia() {
  loading.value = true
  error.value = ''
  searchTruncated.value = false
  try {
    const activeTagFilters = filters.value.tags.length
      ? [...filters.value.tags]
      : (filters.value.tag ? [filters.value.tag] : [])
    const response = await listMedia({
      page: page.value,
      limit: itemsPerPage.value,
      search: filters.value.search,
      file_name: filters.value.file_name,
      extension: filters.value.extension,
      comment: filters.value.comment,
      tags: activeTagFilters,
      tag_relation: activeTagFilters.length > 1 ? selectedTagRelation.value : 'and',
      search_regex: filters.value.search_regex,
      case_insensitive: filters.value.case_insensitive,
      filename_regex: filters.value.filename_regex || undefined,
      filename_regex_case_insensitive: filters.value.filename_regex_case_insensitive,
      sort: sortBy.value,
      type: filters.value.type as any,
      uploaded_from: filters.value.uploaded_from,
      uploaded_to: filters.value.uploaded_to,
      size_min: sizeToBytes(filters.value.size_min, filters.value.size_unit),
      size_max: sizeToBytes(filters.value.size_max, filters.value.size_unit),
      folder: mode.value === 'folder' ? selectedFolder.value : undefined,
      orphan: filters.value.orphan
    })
    files.value = response.files
    searchTruncated.value = response.search_truncated === true
    total.value = response.total
    pages.value = response.pages || 1
  } catch (err: any) {
    files.value = []
    total.value = 0
    pages.value = 1
    const status = err?.statusCode ?? err?.response?.status
    error.value = status
      ? (err?.data?.statusMessage || err?.statusMessage || err?.message || t('admin.media.searchError'))
      : t('admin.media.searchNetworkError')
  } finally {
    loading.value = false
  }
}

async function loadFolders() {
  const response = await listFolders()
  folders.value = response.folders
  facetsTruncated.value ||= response.truncated === true
}

async function loadMediaTags() {
  const response = await listMediaTags()
  mediaTags.value = response.tags
  facetsTruncated.value ||= response.truncated === true
}

async function loadSmartFolders() {
  try {
    const response = await $fetch<{ folders: SmartFolder[] }>('/api/media/smart-folders')
    smartFolders.value = response.folders
  } catch { /* smart folders not yet created */ }
}

function handleAdvancedSearch(value: MediaFilters) {
  filters.value = { ...defaultFilters(), ...value }
  mode.value = 'all'
  selectedFolder.value = ''
  selectedMediaTags.value = []
  selectedTagRelation.value = 'and'
  selectedSmartFolder.value = ''
  searchModalOpen.value = false
  page.value = 1
  void loadMedia()
}

function changePage(nextPage: number) {
  page.value = nextPage
  void loadMedia()
}

function selectAll() {
  mode.value = 'all'
  selectedFolder.value = ''
  selectedMediaTags.value = []
  selectedTagRelation.value = 'and'
  selectedSmartFolder.value = ''
  filters.value.tag = ''
  filters.value.tags = []
  filters.value.filename_regex = ''
  filters.value.filename_regex_case_insensitive = true
  page.value = 1
  void loadMedia()
}

function selectTagsView() {
  mode.value = 'tag'
  selectedFolder.value = ''
  selectedMediaTags.value = []
  selectedTagRelation.value = 'and'
  selectedSmartFolder.value = ''
  filters.value = defaultFilters()
  page.value = 1
}

function clearFilters() {
  if (mode.value === 'tag' && selectedMediaTags.value.length) {
    clearTagSelection()
    return
  }
  filters.value = defaultFilters()
  page.value = 1
  void loadMedia()
}

function selectFolder(id: string) {
  mode.value = 'folder'
  selectedFolder.value = id
  selectedMediaTags.value = []
  selectedTagRelation.value = 'and'
  selectedSmartFolder.value = ''
  filters.value.filename_regex = ''
  filters.value.filename_regex_case_insensitive = true
  filters.value.tag = ''
  filters.value.tags = []
  page.value = 1
  void loadMedia()
}

function setSelectedTagRelation(relation: 'and' | 'or') {
  if (selectedTagRelation.value === relation) return
  selectedTagRelation.value = relation
  if (mode.value === 'tag' && selectedMediaTags.value.length) {
    page.value = 1
    void loadMedia()
  }
}

function clearTagSelection() {
  mode.value = 'tag'
  selectedMediaTags.value = []
  selectedTagRelation.value = 'and'
  selectedFolder.value = ''
  selectedSmartFolder.value = ''
  filters.value = defaultFilters()
  page.value = 1
}

function applySelectedMediaTags() {
  mode.value = 'tag'
  selectedFolder.value = ''
  selectedSmartFolder.value = ''
  sortBy.value = 'uploaded_at_desc'
  filters.value = {
    ...defaultFilters(),
    tags: [...selectedMediaTags.value]
  }
  page.value = 1
  void loadMedia()
}

function toggleMediaTag(tag: string) {
  const next = new Set(selectedMediaTags.value)
  if (next.has(tag)) {
    next.delete(tag)
  } else {
    next.add(tag)
  }

  selectedMediaTags.value = [...next]

  if (!selectedMediaTags.value.length) {
    clearTagSelection()
    return
  }

  applySelectedMediaTags()
}

function isMediaTagSelected(tag: string) {
  return selectedMediaTags.value.includes(tag)
}

function selectSmartFolderById(id: string) {
  const sf = smartFolders.value.find((f) => f.id === id)
  if (!sf) return
  mode.value = 'smart'
  selectedSmartFolder.value = id
  selectedFolder.value = ''
  selectedMediaTags.value = []
  selectedTagRelation.value = 'and'
  // Apply smart folder filters
  filters.value = {
    search: '',
    file_name: '',
    extension: '',
    comment: '',
    tags: sf.filters.tags || [],
    search_regex: false,
    case_insensitive: true,
    filename_regex: sf.filters.filename_regex || '',
    filename_regex_case_insensitive: sf.filters.filename_regex_case_insensitive !== false,
    type: sf.filters.file_type || 'all',
    tag: '',
    uploaded_from: sf.filters.date_from || '',
    uploaded_to: sf.filters.date_to || '',
    size_min: '',
    size_max: '',
    size_unit: 'KB',
    orphan: sf.filters.orphan_only || false
  }
  page.value = 1
  void loadMedia()
}

function handleItemClick(file: MediaRecord) {
  if (selectedHashes.value.size > 0) {
    toggleSelection(file.hash)
  } else {
    selectedMedia.value = file
    pushSelectedMediaRoute(file.hash)
  }
}

function toggleSelection(hash: string) {
  const next = new Set(selectedHashes.value)
  if (next.has(hash)) next.delete(hash)
  else next.add(hash)
  selectedHashes.value = next
  lastSelectedHash.value = hash
}

function selectAllFiles() {
  selectedHashes.value = new Set(files.value.map((f) => f.hash))
  if (files.value[0]) lastSelectedHash.value = files.value[0].hash
}

function clearSelection() {
  selectedHashes.value = new Set()
  lastSelectedHash.value = ''
}

function selectRangeTo(hash: string) {
  const targetIndex = files.value.findIndex((file) => file.hash === hash)
  const startIndex = files.value.findIndex((file) => file.hash === lastSelectedHash.value)

  if (targetIndex === -1 || startIndex === -1) {
    toggleSelection(hash)
    return
  }

  const [from, to] = startIndex < targetIndex ? [startIndex, targetIndex] : [targetIndex, startIndex]
  const next = new Set(selectedHashes.value)
  for (const file of files.value.slice(from, to + 1)) {
    next.add(file.hash)
  }
  selectedHashes.value = next
  lastSelectedHash.value = hash
}

function addDragSelection(hash: string) {
  const next = new Set(selectedHashes.value)
  next.add(hash)
  selectedHashes.value = next
  lastSelectedHash.value = hash
}

function changeSort(nextSort: string) {
  sortBy.value = nextSort
  page.value = 1
  void loadMedia()
}

function changePageSize(nextSize: string) {
  const parsed = Number(nextSize)
  itemsPerPage.value = Number.isFinite(parsed) ? parsed : 24
  page.value = 1
  void loadMedia()
}

function openBulkDeleteDialog() {
  if (selectedHashes.value.size === 0) {
    return
  }

  bulkDeleteDialogOpen.value = true
}

function closeBulkDeleteDialog() {
  if (bulkDeletePending.value) {
    return
  }

  bulkDeleteDialogOpen.value = false
}

async function confirmBulkDelete() {
  if (selectedHashes.value.size === 0) {
    closeBulkDeleteDialog()
    return
  }

  bulkDeletePending.value = true
  try {
    await $fetch('/api/media/bulk', {
      method: 'POST',
      body: { action: 'delete', hashes: [...selectedHashes.value] }
    })
    adminToast.success(t('admin.media.bulkDeleted', { count: selectedHashes.value.size }))
    selectedHashes.value = new Set()
    closeBulkDeleteDialog()
    await loadMedia()
    await loadMediaTags()
  } catch (err: any) {
    adminToast.error(err, t('admin.media.bulkDeleteFailed'))
  } finally {
    bulkDeletePending.value = false
  }
}

function openOrphanCleanupDialog() {
  if (selectedHashes.value.size === 0) {
    return
  }

  orphanCleanupDialogOpen.value = true
}

function closeOrphanCleanupDialog() {
  if (orphanCleanupPending.value) {
    return
  }

  orphanCleanupDialogOpen.value = false
}

async function confirmOrphanCleanup() {
  if (selectedHashes.value.size === 0) {
    closeOrphanCleanupDialog()
    return
  }

  orphanCleanupPending.value = true
  try {
    const result = await cleanupOrphans({ hashes: [...selectedHashes.value] })
    if (result.incomplete) adminToast.info(t('admin.media.cleanupIncomplete', {count: result.deleted_count, failed: result.failed_count}))
    else adminToast.success(t('admin.media.orphansDeleted', { count: result.deleted_count }))
    selectedHashes.value = new Set()
    closeOrphanCleanupDialog()
    await loadMedia()
    await loadMediaTags()
  } catch (err: any) {
    adminToast.error(err, t('admin.media.deleteOrphansFailed'))
  } finally {
    orphanCleanupPending.value = false
  }
}

function promptBulkTags() {
  if (selectedHashes.value.size === 0) {
    return
  }

  bulkTagsDialogOpen.value = true
}

function promptBulkComment() {
  if (selectedHashes.value.size === 0) {
    return
  }

  bulkCommentDialogOpen.value = true
}

function confirmBulkTags(input: string) {
  bulkTagsDialogOpen.value = false
  const tags = input.split(',').map((tag) => tag.trim()).filter(Boolean)
  void handleBulkTags(tags)
}

function confirmBulkComment(comment: string) {
  bulkCommentDialogOpen.value = false
  void handleBulkComment(comment)
}

async function handleBulkTags(tags: string[]) {
  try {
    await $fetch('/api/media/bulk', {
      method: 'POST',
      body: { action: 'update', hashes: [...selectedHashes.value], data: { tags } }
    })
    adminToast.success(t('admin.media.bulkTagsUpdated', { count: selectedHashes.value.size }))
    selectedHashes.value = new Set()
    await loadMedia()
    await loadMediaTags()
  } catch (err: any) {
    adminToast.error(err, t('admin.media.bulkTagUpdateFailed'))
  }
}

async function handleBulkComment(comment: string) {
  try {
    await $fetch('/api/media/bulk', {
      method: 'POST',
      body: { action: 'update', hashes: [...selectedHashes.value], data: { comment } }
    })
    adminToast.success(t('admin.media.bulkCommentUpdated', { count: selectedHashes.value.size }))
    selectedHashes.value = new Set()
    await loadMedia()
  } catch (err: any) {
    adminToast.error(err, t('admin.media.bulkCommentUpdateFailed'))
  }
}

async function handleBulkMove(folderId: string) {
  try {
    await $fetch('/api/media/bulk', {
      method: 'POST',
      body: { action: 'update', hashes: [...selectedHashes.value], data: { folders: [folderId] } }
    })
    adminToast.success(t('admin.media.bulkAssigned', { count: selectedHashes.value.size }))
    selectedHashes.value = new Set()
    await loadMedia()
  } catch (err: any) {
    adminToast.error(err, t('admin.media.bulkAssignFailed'))
  }
}

function promptBulkAssignFolder() {
  if (selectedHashes.value.size === 0) {
    return
  }

  if (!folders.value.length) {
    adminToast.error(new Error(t('admin.media.createFolderFirst')), t('admin.media.createFolderFirst'))
    return
  }

  bulkAssignFolderDialogOpen.value = true
}

function confirmBulkAssignFolder(folderId: string) {
  bulkAssignFolderDialogOpen.value = false
  void handleBulkMove(folderId)
}

async function handleBulkAddToFolder(folderId: string) {
  try {
    await $fetch('/api/media/bulk', {
      method: 'POST',
      body: { action: 'update', hashes: [...selectedHashes.value], data: { folders: [folderId], folderMode: 'add' } }
    })
    adminToast.success(t('admin.media.bulkAddedToFolder', { count: selectedHashes.value.size }))
    selectedHashes.value = new Set()
    await loadMedia()
  } catch (err: any) {
    adminToast.error(err, t('admin.media.bulkFolderUpdateFailed'))
  }
}

async function handleBulkDownload() {
  try {
    const response = await $fetch<{ type: string; url: string }>('/api/media/download', {
      method: 'POST',
      body: { hashes: [...selectedHashes.value] }
    })
    // Trigger download
    const link = document.createElement('a')
    link.href = response.url
    link.download = ''
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    adminToast.success(t('admin.media.downloadStarted'))
  } catch (err: any) {
    const status = Number(err?.statusCode ?? err?.status ?? err?.response?.status)
    const key = status === 404 ? 'admin.media.selectionUnavailable' : status === 503 ? 'admin.media.archiveUnavailable' : 'admin.media.downloadFailed'
    adminToast.error(null, t(key))
  }
}

function openFolderModal() {
  folderModalOpen.value = true
}

async function handleCreateFolder(name: string) {
  try {
    await createFolder(name)
    folderModalOpen.value = false
    adminToast.success(t('admin.media.createdFolder', { name }))
    await loadFolders()
  } catch (err: any) {
    adminToast.error(err, t('admin.media.createFolderFailed'))
  }
}

async function handleRenameFolder(id: string, name: string) {
  try {
    await updateFolder(id, { name })
    await loadFolders()
    adminToast.success(t('admin.media.folderRenamed'))
  } catch (err: any) {
    adminToast.error(err, t('admin.media.renameFolderFailed'))
  }
}

async function handleDeleteFolder(id: string) {
  try {
    await deleteFolder(id)
    if (selectedFolder.value === id) selectAll()
    await loadFolders()
    await loadMedia()
    adminToast.success(t('admin.media.folderDeleted'))
  } catch (err: any) {
    adminToast.error(err, t('admin.media.deleteFolderFailed'))
  }
}

async function assignFileToFolder(hash: string, folderId: string) {
  const file = await getMedia(hash) // List DTOs intentionally omit/clip legacy detail metadata.
  const foldersForFile = Array.from(new Set([...(file.folders || []), folderId]))
  const updated = await updateMedia(file.id, { folders: foldersForFile })
  handleFileUpdated(updated)
  adminToast.success(t('admin.media.fileAssigned'))
}

async function handleUploadComplete(results: Array<{ status: string }>) {
  mode.value = 'all'
  selectedFolder.value = ''
  selectedSmartFolder.value = ''
  selectedMediaTags.value = []
  filters.value = defaultFilters()
  page.value = 1
  const createdCount = results.filter((result) => result.status === 'created').length
  if (createdCount > 0) {
    adminToast.success(t('admin.media.uploadedCount', { count: createdCount }))
  }
  await loadMedia()
  await loadMediaTags()
}

async function openById(id: string) {
  selectedMedia.value = await getMedia(id)
  pushSelectedMediaRoute(selectedMedia.value.hash)
}

async function openRouteMediaFile() {
  const fileId = stringQueryParam(route.query.file)
  if (!fileId) {
    selectedMedia.value = null
    return
  }

  if (selectedMedia.value?.hash === fileId || selectedMedia.value?.id === fileId) {
    return
  }

  try {
    selectedMedia.value = await getMedia(fileId)
  } catch (err: any) {
    adminToast.error(err, t('admin.media.loadFailed'))
  }
}

async function ensureInitialMediaDetailHistory() {
  if (!import.meta.client) return

  const fileId = stringQueryParam(route.query.file)
  if (!fileId) return

  const back = typeof window.history.state?.back === 'string' ? window.history.state.back : ''
  if (back.startsWith('/admin/media')) return

  const query = { ...route.query }
  delete query.file

  syncingMediaRoute = true
  try {
    await router.replace({ query })
    await router.push({ query: { ...query, file: fileId } })
  } finally {
    syncingMediaRoute = false
  }
}

function closeDetailPanel() {
  selectedMedia.value = null
  if (!route.query.file) return

  const query = { ...route.query }
  delete query.file
  void router.push({ query })
}

function pushSelectedMediaRoute(fileHash: string) {
  if (stringQueryParam(route.query.file) === fileHash) return

  void router.push({
    query: {
      ...route.query,
      file: fileHash
    }
  })
}

function stringQueryParam(value: unknown) {
  return typeof value === 'string' ? value : Array.isArray(value) && typeof value[0] === 'string' ? value[0] : ''
}

function applyRouteFilters() {
  const type = stringQueryParam(route.query.type)
  if (!isMediaType(type)) return

  mode.value = 'all'
  selectedFolder.value = ''
  selectedMediaTags.value = []
  selectedTagRelation.value = 'and'
  selectedSmartFolder.value = ''
  filters.value = {
    ...defaultFilters(),
    type
  }
  page.value = 1
}

function isMediaType(type: string): type is MediaFilters['type'] {
  return ['image', 'video', 'audio', 'document', 'archive', 'other'].includes(type)
}

function handleFileUpdated(file: MediaRecord) {
  files.value = files.value.map((item) => item.hash === file.hash ? file : item)
  if (selectedMedia.value?.hash === file.hash) {
    selectedMedia.value = file
  }
  void loadMediaTags()
}

async function handleFileDeleted(file: MediaRecord) {
  files.value = files.value.filter((item) => item.hash !== file.hash)
  selectedMedia.value = null
  await loadMedia()
  await loadMediaTags()
}

// Smart folder modal
function openSmartFolderModal(folder?: SmartFolder) {
  editingSmartFolder.value = folder || null
  smartFolderModalOpen.value = true
}

async function handleSmartFolderSaved() {
  smartFolderModalOpen.value = false
  await loadSmartFolders()
}

async function handleDeleteSmartFolder(id: string) {
  pendingDeleteSmartFolderId.value = id
  smartFolderDeleteDialogOpen.value = true
}

function closeSmartFolderDeleteDialog() {
  if (smartFolderDeletePending.value) {
    return
  }

  smartFolderDeleteDialogOpen.value = false
  pendingDeleteSmartFolderId.value = ''
}

async function confirmDeleteSmartFolder() {
  const id = pendingDeleteSmartFolderId.value
  if (!id) {
    closeSmartFolderDeleteDialog()
    return
  }

  smartFolderDeletePending.value = true
  try {
    await $fetch(`/api/media/smart-folders/${id}`, { method: 'DELETE' })
    if (selectedSmartFolder.value === id) selectAll()
    await loadSmartFolders()
    closeSmartFolderDeleteDialog()
    adminToast.success(t('admin.media.smartFolderDeleted'))
  } catch (err: any) {
    adminToast.error(err, t('admin.media.smartFolderDeleteFailed'))
  } finally {
    smartFolderDeletePending.value = false
  }
}

function sizeToBytes(value: string, unit: 'KB' | 'MB' | 'GB'): number | undefined {
  const amount = Number(String(value).trim())
  if (!Number.isFinite(amount) || amount <= 0) return undefined
  const factor = unit === 'GB' ? 1024 ** 3 : unit === 'MB' ? 1024 ** 2 : 1024
  return Math.floor(amount * factor)
}

function defaultFilters(): MediaFilters {
  return {
    search: '',
    file_name: '',
    extension: '',
    comment: '',
    tags: [],
    type: 'all',
    tag: '',
    uploaded_from: '',
    uploaded_to: '',
    orphan: false,
    search_regex: false,
    case_insensitive: true,
    filename_regex: '',
    filename_regex_case_insensitive: true,
    size_min: '',
    size_max: '',
    size_unit: 'KB'
  }
}
</script>
