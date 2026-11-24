<template>
  <section class="grid gap-6">
    <div class="grid gap-4">
      <div class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p class="text-sm font-medium uppercase tracking-wider text-[var(--pb-primary)]">{{ t('admin.posts.contentEyebrow') }}</p>
          <h1 class="mt-1 text-3xl font-semibold tracking-normal text-[var(--pb-text)]">{{ t('admin.posts.eyebrow') }}</h1>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <UBadge v-if="selectedIds.length" color="neutral" variant="subtle">{{ t('admin.posts.selected', { count: selectedIds.length }) }}</UBadge>
          <UDropdownMenu v-if="selectedIds.length" :items="actionsMenuItems">
            <UButton icon="i-lucide-list-checks" color="neutral" variant="soft" :loading="bulkDeleting" :disabled="bulkDeleting">
              {{ t('admin.common.actions') }}
            </UButton>
          </UDropdownMenu>
          <UBadge v-if="quickEditEnabled && !isArchivedView" color="primary" variant="subtle">{{ t('admin.posts.quickEditOn') }}</UBadge>
          <UButton v-if="filtersActive" icon="i-lucide-filter-x" color="neutral" variant="soft" @click="clearFilters">
            {{ t('admin.posts.columnFilter.clearAll') }}
          </UButton>
          <UButton icon="i-lucide-settings" to="/admin/settings/versioning" color="neutral" variant="soft">
            {{ t('admin.common.settings') }}
          </UButton>
          <UButton icon="i-lucide-plus" :loading="creating" @click="createPost">
            {{ t('admin.posts.newPost') }}
          </UButton>
        </div>
      </div>
    </div>

    <UAlert v-if="error" color="error" icon="i-lucide-circle-alert" :title="t('admin.posts.loadFailed')" />
    <UAlert v-if="taxonomyError" color="error" icon="i-lucide-circle-alert" :title="t('admin.posts.taxonomyLoadFailed')" />

    <div class="pb-admin-surface overflow-hidden">
      <div v-if="pending" class="grid gap-3 p-5">
        <USkeleton v-for="index in 4" :key="index" class="h-12" />
      </div>

      <template v-else-if="posts.length">
        <div class="grid gap-3 p-3 md:hidden">
          <article
          v-for="post in posts"
          :key="post.id"
          class="grid gap-3 rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] p-4 shadow-[var(--pb-shadow-sm)]"
          :class="selectedIds.includes(post.id) ? 'pb-selected-surface' : ''"
        >
          <div class="flex min-w-0 items-start gap-3">
            <input v-model="selectedIds" type="checkbox" :value="post.id" class="mt-1 rounded border-[var(--pb-border-strong)]" :aria-label="post.title || t('admin.common.untitled')">
            <button type="button" class="min-w-0 flex-1 text-left" @click="openPost(post)">
              <span class="block truncate font-medium text-[var(--pb-text)]">{{ post.title || t('admin.common.untitled') }}</span>
              <span class="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--pb-text-subtle)]">
                <UBadge :color="post.status === 'published' ? 'success' : post.status === 'archived' ? 'warning' : 'neutral'" variant="subtle" size="xs">
                  {{ statusLabel(post.status) }}
                </UBadge>
                <span class="inline-flex items-center gap-1">
                  <UIcon :name="visibilityIcon(post.visibility)" class="size-3.5" />
                  {{ visibilityLabel(post.visibility) }}
                </span>
              </span>
            </button>
            <UDropdownMenu :items="postCardMenuItems(post)">
              <UButton icon="i-lucide-more-vertical" color="neutral" variant="ghost" size="sm" :aria-label="t('admin.common.actions')" />
            </UDropdownMenu>
          </div>

          <div class="grid gap-2 text-sm">
            <div class="grid gap-1">
              <span class="text-xs font-medium uppercase tracking-wide text-[var(--pb-text-subtle)]">{{ t('admin.posts.table.tags') }}</span>
              <span v-if="post.tags?.length" class="flex flex-wrap gap-1">
                <UBadge v-for="tag in post.tags" :key="tag.id" color="neutral" variant="subtle" size="xs">{{ tag.name }}</UBadge>
              </span>
              <span v-else class="text-[var(--pb-text-subtle)]">{{ t('admin.common.noTags') }}</span>
            </div>
            <div class="grid gap-1">
              <span class="text-xs font-medium uppercase tracking-wide text-[var(--pb-text-subtle)]">{{ t('admin.posts.table.categories') }}</span>
              <span v-if="post.categories?.length" class="flex flex-wrap gap-1">
                <UBadge v-for="category in post.categories" :key="category.id" color="primary" variant="subtle" size="xs">{{ category.name }}</UBadge>
              </span>
              <span v-else class="text-[var(--pb-text-subtle)]">{{ t('admin.common.noCategories') }}</span>
            </div>
          </div>

          <dl class="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-[var(--pb-text-subtle)]">{{ t('admin.posts.table.length') }}</dt>
              <dd class="mt-1 text-[var(--pb-text-muted)]">{{ formatContentLength(post) }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-[var(--pb-text-subtle)]">{{ t('admin.posts.table.updated') }}</dt>
              <dd class="mt-1 text-[var(--pb-text-muted)]">{{ formatDate(post.updated_at, t('admin.posts.notSet')) }}</dd>
            </div>
            <div>
              <dt class="text-xs font-medium uppercase tracking-wide text-[var(--pb-text-subtle)]">{{ t('admin.posts.table.published') }}</dt>
              <dd class="mt-1 text-[var(--pb-text-muted)]">{{ formatDate(post.published_at, t('admin.posts.notPublished')) }}</dd>
            </div>
            <div v-if="isSavingPost(post.id)">
              <dt class="text-xs font-medium uppercase tracking-wide text-[var(--pb-text-subtle)]">{{ t('admin.posts.saving') }}</dt>
              <dd class="mt-1 text-[var(--pb-link)]">{{ t('admin.posts.saving') }}</dd>
            </div>
          </dl>
          </article>
        </div>

        <div class="hidden overflow-x-auto md:block">
          <table class="w-full min-w-[1120px] border-collapse text-left text-sm">
          <thead class="bg-[var(--pb-surface-subtle)] text-xs uppercase tracking-wider text-[var(--pb-text-subtle)]">
            <tr>
              <th class="w-12 px-4 py-3 font-medium">
                <input
                  type="checkbox"
                  class="rounded border-[var(--pb-border-strong)]"
                  :checked="allVisibleSelected"
                  :indeterminate.prop="someVisibleSelected"
                  @click.stop
                  @change="toggleSelectAll($event)"
                >
              </th>
              <th class="min-w-64 px-4 py-3 font-medium">
                <AdminPostColumnFilter
                  :label="t('admin.posts.table.title')"
                  sortable
                  :sort-dir="sortKey === 'title' ? sortDir : null"
                  :active="titleActive"
                  @sort="(dir) => setSort('title', dir)"
                  @clear="titleQuery = ''"
                >
                  <div class="grid gap-1.5">
                    <UInput
                      v-model="titleQuery"
                      size="sm"
                      icon="i-lucide-regex"
                      :placeholder="t('admin.posts.columnFilter.titlePlaceholder')"
                      :color="titleRegexValid ? undefined : 'error'"
                    />
                    <p v-if="!titleRegexValid" class="text-xs text-[var(--ui-error)]">{{ t('admin.posts.columnFilter.titleInvalid') }}</p>
                  </div>
                </AdminPostColumnFilter>
              </th>
              <th class="min-w-48 px-4 py-3 font-medium">
                <AdminPostColumnFilter
                  :label="t('admin.posts.table.tags')"
                  :active="selectedTagIds.length > 0"
                  @clear="selectedTagIds = []"
                >
                  <div class="grid gap-2">
                    <UInput v-model="tagSearch" size="sm" icon="i-lucide-search" :placeholder="t('admin.posts.columnFilter.searchPlaceholder')" />
                    <div class="grid max-h-56 gap-0.5 overflow-y-auto">
                      <label
                        v-for="option in filteredTagOptions"
                        :key="option.id"
                        class="flex cursor-pointer items-center gap-2 rounded-[var(--pb-radius-sm)] px-1.5 py-1 text-sm text-[var(--pb-text-muted)] hover:bg-[var(--pb-selected-bg)]"
                      >
                        <input v-model="selectedTagIds" type="checkbox" :value="option.id" class="rounded border-[var(--pb-border-strong)]">
                        <span class="truncate">{{ option.name }}</span>
                      </label>
                      <p v-if="!filteredTagOptions.length" class="px-1.5 py-2 text-xs text-[var(--pb-text-subtle)]">{{ t('admin.posts.columnFilter.noResults') }}</p>
                    </div>
                  </div>
                </AdminPostColumnFilter>
              </th>
              <th class="min-w-48 px-4 py-3 font-medium">
                <AdminPostColumnFilter
                  :label="t('admin.posts.table.categories')"
                  :active="selectedCategoryIds.length > 0"
                  @clear="selectedCategoryIds = []"
                >
                  <div class="grid gap-2">
                    <UInput v-model="categorySearch" size="sm" icon="i-lucide-search" :placeholder="t('admin.posts.columnFilter.searchPlaceholder')" />
                    <div class="grid max-h-56 gap-0.5 overflow-y-auto">
                      <label
                        v-for="option in filteredCategoryOptions"
                        :key="option.id"
                        class="flex cursor-pointer items-center gap-2 rounded-[var(--pb-radius-sm)] px-1.5 py-1 text-sm text-[var(--pb-text-muted)] hover:bg-[var(--pb-selected-bg)]"
                        :style="{ paddingLeft: `${0.375 + option.level * 0.85}rem` }"
                      >
                        <input v-model="selectedCategoryIds" type="checkbox" :value="option.id" class="rounded border-[var(--pb-border-strong)]">
                        <span class="truncate">{{ option.name }}</span>
                      </label>
                      <p v-if="!filteredCategoryOptions.length" class="px-1.5 py-2 text-xs text-[var(--pb-text-subtle)]">{{ t('admin.posts.columnFilter.noResults') }}</p>
                    </div>
                  </div>
                </AdminPostColumnFilter>
              </th>
              <th class="min-w-40 px-4 py-3 font-medium">
                <AdminPostColumnFilter
                  :label="t('admin.posts.table.privacy')"
                  sortable
                  :sort-dir="sortKey === 'visibility' ? sortDir : null"
                  :active="selectedVisibilities.length > 0"
                  @sort="(dir) => setSort('visibility', dir)"
                  @clear="selectedVisibilities = []"
                >
                  <div class="grid gap-0.5">
                    <label
                      v-for="option in visibilityFilterOptions"
                      :key="option.value"
                      class="flex cursor-pointer items-center gap-2 rounded-[var(--pb-radius-sm)] px-1.5 py-1 text-sm text-[var(--pb-text-muted)] hover:bg-[var(--pb-selected-bg)]"
                    >
                      <input v-model="selectedVisibilities" type="checkbox" :value="option.value" class="rounded border-[var(--pb-border-strong)]">
                      <span>{{ option.label }}</span>
                    </label>
                  </div>
                </AdminPostColumnFilter>
              </th>
              <th class="min-w-32 px-4 py-3 font-medium">
                <AdminPostColumnFilter
                  :label="t('admin.posts.table.status')"
                  sortable
                  :sort-dir="sortKey === 'status' ? sortDir : null"
                  :active="selectedStatuses.length > 0"
                  @sort="(dir) => setSort('status', dir)"
                  @clear="selectedStatuses = []"
                >
                  <div class="grid gap-0.5">
                    <label
                      v-for="option in statusCheckboxOptions"
                      :key="option.value"
                      class="flex cursor-pointer items-center gap-2 rounded-[var(--pb-radius-sm)] px-1.5 py-1 text-sm text-[var(--pb-text-muted)] hover:bg-[var(--pb-selected-bg)]"
                    >
                      <input v-model="selectedStatuses" type="checkbox" :value="option.value" class="rounded border-[var(--pb-border-strong)]">
                      <span>{{ option.label }}</span>
                    </label>
                  </div>
                </AdminPostColumnFilter>
              </th>
              <th class="min-w-32 px-4 py-3 font-medium">
                <AdminPostColumnFilter
                  :label="t('admin.posts.table.length')"
                  sortable
                  :sort-dir="sortKey === 'length' ? sortDir : null"
                  :active="lengthActive"
                  @sort="(dir) => setSort('length', dir)"
                  @clear="() => { lengthMin = ''; lengthMax = '' }"
                >
                  <div class="grid gap-2">
                    <div class="grid grid-cols-2 gap-2">
                      <UInput v-model="lengthMin" type="number" min="0" size="sm" :placeholder="t('admin.posts.columnFilter.lengthMin')" />
                      <UInput v-model="lengthMax" type="number" min="0" size="sm" :placeholder="t('admin.posts.columnFilter.lengthMax')" />
                    </div>
                    <p class="text-xs text-[var(--pb-text-subtle)]">{{ t('admin.posts.columnFilter.lengthHint') }}</p>
                  </div>
                </AdminPostColumnFilter>
              </th>
              <th class="min-w-36 px-4 py-3 font-medium">
                <AdminPostColumnFilter
                  :label="t('admin.posts.table.published')"
                  sortable
                  :sort-dir="sortKey === 'published' ? sortDir : null"
                  :active="publishedActive"
                  @sort="(dir) => setSort('published', dir)"
                  @clear="() => { publishedFrom = ''; publishedTo = '' }"
                >
                  <div class="grid gap-2">
                    <label class="grid gap-1 text-xs text-[var(--pb-text-subtle)]">
                      {{ t('admin.posts.columnFilter.dateFrom') }}
                      <UInput v-model="publishedFrom" type="date" size="sm" />
                    </label>
                    <label class="grid gap-1 text-xs text-[var(--pb-text-subtle)]">
                      {{ t('admin.posts.columnFilter.dateTo') }}
                      <UInput v-model="publishedTo" type="date" size="sm" />
                    </label>
                  </div>
                </AdminPostColumnFilter>
              </th>
              <th class="min-w-32 px-4 py-3 font-medium">
                <AdminPostColumnFilter
                  :label="t('admin.posts.table.updated')"
                  sortable
                  align="end"
                  :sort-dir="sortKey === 'updated' ? sortDir : null"
                  :active="updatedActive"
                  @sort="(dir) => setSort('updated', dir)"
                  @clear="() => { updatedFrom = ''; updatedTo = '' }"
                >
                  <div class="grid gap-2">
                    <label class="grid gap-1 text-xs text-[var(--pb-text-subtle)]">
                      {{ t('admin.posts.columnFilter.dateFrom') }}
                      <UInput v-model="updatedFrom" type="date" size="sm" />
                    </label>
                    <label class="grid gap-1 text-xs text-[var(--pb-text-subtle)]">
                      {{ t('admin.posts.columnFilter.dateTo') }}
                      <UInput v-model="updatedTo" type="date" size="sm" />
                    </label>
                  </div>
                </AdminPostColumnFilter>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[var(--pb-border)]">
            <tr
              v-for="post in posts"
              :key="post.id"
              v-memo="postRowMemo(post)"
              class="cursor-pointer hover:bg-[var(--pb-surface-subtle)]"
              :class="editingCell?.postId === post.id ? 'pb-selected-surface' : ''"
              @click="onRowActivate(post)"
            >
              <td class="px-4 py-3 align-top" @click.stop>
                <input v-model="selectedIds" type="checkbox" :value="post.id" class="rounded border-[var(--pb-border-strong)]">
              </td>

              <td class="px-4 py-3 align-top" @click="onCellClick(post, 'title', $event)">
                <input
                  v-if="isEditing(post, 'title')"
                  v-model="draft.title"
                  :data-inline-editor="inlineEditorKey(post.id, 'title')"
                  class="w-full rounded-[var(--pb-radius-sm)] border border-[var(--pb-selected-border)] bg-[var(--pb-card-bg)] px-2 py-1.5 text-sm font-medium text-[var(--pb-text)] shadow-[var(--pb-shadow-sm)] outline-none focus:border-[var(--pb-selected-border)] focus:ring-2 focus:ring-[var(--pb-selected-border)]"
                  @click.stop
                  @keydown.enter.prevent="saveCurrentCell({ close: true })"
                  @keydown.esc.prevent="cancelCellEdit"
                  @blur="saveCurrentCell({ close: true })"
                >
                <button v-else type="button" class="block w-full text-left font-medium text-[var(--pb-text)] hover:text-[var(--pb-link-hover)]">
                  {{ post.title || t('admin.common.untitled') }}
                </button>
              </td>

              <td class="px-4 py-3 align-top" @click="onCellClick(post, 'tags', $event)">
                <div
                  v-if="isEditing(post, 'tags')"
                  :data-inline-editor="inlineEditorKey(post.id, 'tags')"
                  class="grid gap-2 rounded-[var(--pb-radius-sm)] border border-[var(--pb-selected-border)] bg-[var(--pb-card-bg)] p-2 shadow-[var(--pb-shadow-sm)]"
                  tabindex="-1"
                  @click.stop
                  @keydown.esc.prevent="cancelCellEdit"
                  @focusout="handleCellFocusOut"
                >
                  <div class="grid max-h-32 gap-1 overflow-y-auto pr-1">
                    <label v-for="tag in tagOptions" :key="tag.id" class="flex cursor-pointer items-center gap-2 rounded-[var(--pb-radius-sm)] px-1 py-0.5 text-xs text-[var(--pb-text-muted)] hover:bg-[var(--pb-selected-bg)]">
                      <input v-model="draft.tagIds" type="checkbox" :value="tag.id" class="rounded border-[var(--pb-border-strong)]" @change="saveCurrentCell()">
                      <span>{{ tag.name }}</span>
                    </label>
                    <p v-if="!tagOptions.length" class="text-xs text-[var(--pb-text-subtle)]">{{ t('admin.posts.noTagsYet') }}</p>
                  </div>
                  <input
                    v-model="draft.tagNamesInput"
                    class="w-full rounded-[var(--pb-radius-sm)] border border-[var(--pb-border-strong)] bg-[var(--pb-card-bg)] px-2 py-1 text-xs text-[var(--pb-text)] outline-none focus:border-[var(--pb-selected-border)] focus:ring-2 focus:ring-[var(--pb-selected-border)]"
                    :placeholder="t('admin.posts.addTags')"
                    @keydown.enter.prevent="saveCurrentCell({ close: true })"
                  >
                </div>
                <button v-else type="button" class="block w-full text-left">
                  <span v-if="post.tags?.length" class="flex flex-wrap gap-1">
                    <UBadge v-for="tag in post.tags" :key="tag.id" color="neutral" variant="subtle">{{ tag.name }}</UBadge>
                  </span>
                  <span v-else class="text-[var(--pb-text-subtle)]">{{ t('admin.common.noTags') }}</span>
                </button>
              </td>

              <td class="px-4 py-3 align-top" @click="onCellClick(post, 'categories', $event)">
                <div
                  v-if="isEditing(post, 'categories')"
                  :data-inline-editor="inlineEditorKey(post.id, 'categories')"
                  class="grid gap-2 rounded-[var(--pb-radius-sm)] border border-[var(--pb-selected-border)] bg-[var(--pb-card-bg)] p-2 shadow-[var(--pb-shadow-sm)]"
                  tabindex="-1"
                  @click.stop
                  @keydown.esc.prevent="cancelCellEdit"
                  @focusout="handleCellFocusOut"
                >
                  <div class="grid max-h-32 gap-1 overflow-y-auto pr-1">
                    <label v-for="category in categoryOptions" :key="category.id" class="flex cursor-pointer items-center gap-2 rounded-[var(--pb-radius-sm)] px-1 py-0.5 text-xs text-[var(--pb-text-muted)] hover:bg-[var(--pb-selected-bg)]">
                      <input v-model="draft.categoryIds" type="checkbox" :value="category.id" class="rounded border-[var(--pb-border-strong)]" @change="saveCurrentCell()">
                      <span>{{ category.name }}</span>
                    </label>
                    <p v-if="!categoryOptions.length" class="text-xs text-[var(--pb-text-subtle)]">{{ t('admin.posts.noCategoriesYet') }}</p>
                  </div>
                  <input
                    v-model="draft.categoryNamesInput"
                    class="w-full rounded-[var(--pb-radius-sm)] border border-[var(--pb-border-strong)] bg-[var(--pb-card-bg)] px-2 py-1 text-xs text-[var(--pb-text)] outline-none focus:border-[var(--pb-selected-border)] focus:ring-2 focus:ring-[var(--pb-selected-border)]"
                    :placeholder="t('admin.posts.addCategories')"
                    @keydown.enter.prevent="saveCurrentCell({ close: true })"
                  >
                </div>
                <button v-else type="button" class="block w-full text-left">
                  <span v-if="post.categories?.length" class="flex flex-wrap gap-1">
                    <UBadge v-for="category in post.categories" :key="category.id" color="primary" variant="subtle">{{ category.name }}</UBadge>
                  </span>
                  <span v-else class="text-[var(--pb-text-subtle)]">{{ t('admin.common.noCategories') }}</span>
                </button>
              </td>

              <td class="px-4 py-3 align-top" @click="onCellClick(post, 'visibility', $event)">
                <select
                  v-if="isEditing(post, 'visibility')"
                  v-model="draft.visibility"
                  :data-inline-editor="inlineEditorKey(post.id, 'visibility')"
                  class="w-full rounded-[var(--pb-radius-sm)] border border-[var(--pb-selected-border)] bg-[var(--pb-card-bg)] px-2 py-1.5 text-sm text-[var(--pb-text-muted)] shadow-[var(--pb-shadow-sm)] outline-none focus:border-[var(--pb-selected-border)] focus:ring-2 focus:ring-[var(--pb-selected-border)]"
                  @click.stop
                  @change="handleVisibilityChange(post)"
                  @keydown.esc.prevent="cancelCellEdit"
                  @blur="handleVisibilityBlur"
                >
                  <option value="public">{{ t('admin.posts.visibility.public') }}</option>
                  <option value="password">{{ t('admin.posts.visibility.password') }}</option>
                  <option value="private">{{ t('admin.posts.visibility.private') }}</option>
                </select>
                <button v-else type="button" class="inline-flex items-center gap-1.5 text-[var(--pb-text-muted)] hover:text-[var(--pb-link-hover)]">
                  <UIcon :name="visibilityIcon(post.visibility)" class="size-4" />
                  <span>{{ visibilityLabel(post.visibility) }}</span>
                </button>
              </td>

              <td class="px-4 py-3 align-top" @click="onCellClick(post, 'status', $event)">
                <select
                  v-if="isEditing(post, 'status')"
                  v-model="draft.status"
                  :data-inline-editor="inlineEditorKey(post.id, 'status')"
                  class="w-full rounded-[var(--pb-radius-sm)] border border-[var(--pb-selected-border)] bg-[var(--pb-card-bg)] px-2 py-1.5 text-sm text-[var(--pb-text-muted)] shadow-[var(--pb-shadow-sm)] outline-none focus:border-[var(--pb-selected-border)] focus:ring-2 focus:ring-[var(--pb-selected-border)]"
                  @click.stop
                  @change="saveCurrentCell({ close: true })"
                  @keydown.esc.prevent="cancelCellEdit"
                  @blur="saveCurrentCell({ close: true })"
                >
                  <option value="draft">{{ t('admin.posts.status.draft') }}</option>
                  <option value="published">{{ t('admin.posts.status.published') }}</option>
                </select>
                <UBadge v-else :color="post.status === 'published' ? 'success' : 'neutral'" variant="subtle">
                  {{ statusLabel(post.status) }}
                </UBadge>
              </td>

              <td class="px-4 py-3 align-top text-[var(--pb-text-muted)]">
                <span class="block text-sm">{{ formatContentLength(post) }}</span>
              </td>

              <td class="px-4 py-3 align-top text-[var(--pb-text-muted)]">
                {{ formatDate(post.published_at, t('admin.posts.notPublished')) }}
              </td>

              <td class="px-4 py-3 align-top text-[var(--pb-text-muted)]">
                <span>{{ formatDate(post.updated_at, t('admin.posts.notSet')) }}</span>
                <span v-if="isSavingPost(post.id)" class="mt-1 block text-xs text-[var(--pb-link)]">{{ t('admin.posts.saving') }}</span>
              </td>
            </tr>
          </tbody>
          </table>
        </div>
      </template>

      <UEmpty v-else icon="i-lucide-file-text" :title="t('admin.posts.emptyTitle')" :description="t('admin.posts.emptyDescription')" class="py-12" />

      <div v-if="!pending && totalPosts > 0" class="flex flex-col gap-3 border-t border-[var(--pb-border)] px-4 py-3 text-sm text-[var(--pb-text-muted)] md:flex-row md:items-center md:justify-between">
        <div class="flex items-center gap-3">
          <span>{{ pageRangeLabel }}</span>
          <USelect v-model="perPage" :items="perPageOptions" size="sm" class="w-28" />
        </div>
        <div class="flex items-center gap-2">
          <UButton size="sm" variant="ghost" color="neutral" icon="i-lucide-chevrons-left" :aria-label="t('admin.common.firstPage')" :disabled="page <= 1" @click="goToPage(1)" />
          <UButton size="sm" variant="ghost" color="neutral" icon="i-lucide-chevron-left" :aria-label="t('admin.common.previousPage')" :disabled="page <= 1" @click="goToPage(page - 1)" />
          <span class="min-w-24 text-center">{{ t('admin.common.pageOf', { page, total: totalPages }) }}</span>
          <UButton size="sm" variant="ghost" color="neutral" icon="i-lucide-chevron-right" :aria-label="t('admin.common.nextPage')" :disabled="page >= totalPages" @click="goToPage(page + 1)" />
          <UButton size="sm" variant="ghost" color="neutral" icon="i-lucide-chevrons-right" :aria-label="t('admin.common.lastPage')" :disabled="page >= totalPages" @click="goToPage(totalPages)" />
        </div>
      </div>
    </div>

    <AdminConfirmActionDialog
      :open="confirmDialog.open"
      :title="confirmDialog.title"
      :description="confirmDialog.description"
      :confirm-label="confirmDialog.confirmLabel"
      :confirm-color="confirmDialog.confirmColor"
      :loading="bulkDeleting"
      @update:open="(value) => { if (!value) closeConfirmDialog() }"
      @cancel="closeConfirmDialog"
      @confirm="confirmBulkAction"
    />

    <AdminPromptDialog
      :open="passwordDialogOpen"
      :title="t('admin.posts.passwordPrompt.title')"
      :description="t('admin.posts.passwordPrompt.description')"
      :label="t('admin.posts.passwordPrompt.label')"
      input-type="password"
      :confirm-label="t('admin.posts.passwordPrompt.confirm')"
      @update:open="(value) => { if (!value) cancelPasswordDialog() }"
      @cancel="cancelPasswordDialog"
      @confirm="confirmPasswordDialog"
    />
  </section>
</template>

<script setup lang="ts">
import type { CategoryRecord, PostRecord, PostStatus, PostVisibility, TagRecord } from '~/types/content'
import {
  ADMIN_POST_DEFAULT_SORT_DIR,
  ADMIN_POST_DEFAULT_SORT_KEY,
  ADMIN_POST_LIST_PREFS_STORAGE_KEY,
  createDefaultAdminPostListPrefs,
  parseAdminPostListPrefs,
  type AdminPostListPrefs,
  type AdminPostPerPage,
  type AdminPostSortDir,
  type AdminPostSortKey
} from '~/utils/adminPostListPrefs'

definePageMeta({ layout: 'admin' })


type BulkIntent = 'archive' | 'hard-delete' | 'mixed'
type SortKey = AdminPostSortKey
type SortDir = AdminPostSortDir
type PerPageOption = AdminPostPerPage

type EditableField = 'title' | 'tags' | 'categories' | 'visibility' | 'status'

const { t } = useI18n()
const { formatAdminDate, formatAdminNumber } = useAdminRegionalSettings()
const sessionFetch = useSessionFetch()
const creating = ref(false)
const adminPostListPrefs = useState<AdminPostListPrefs>(
  'pb-admin-posts-list-prefs',
  createDefaultAdminPostListPrefs
)
const initialPrefs = adminPostListPrefs.value
const titleQuery = ref(initialPrefs.titleQuery)
const tagSearch = ref(initialPrefs.tagSearch)
const categorySearch = ref(initialPrefs.categorySearch)
const selectedStatuses = ref<PostStatus[]>([...initialPrefs.selectedStatuses])
const selectedVisibilities = ref<PostVisibility[]>([...initialPrefs.selectedVisibilities])
const lengthMin = ref(initialPrefs.lengthMin)
const lengthMax = ref(initialPrefs.lengthMax)
const publishedFrom = ref(initialPrefs.publishedFrom)
const publishedTo = ref(initialPrefs.publishedTo)
const updatedFrom = ref(initialPrefs.updatedFrom)
const updatedTo = ref(initialPrefs.updatedTo)
const sortKey = ref<SortKey>(initialPrefs.sortKey)
const sortDir = ref<SortDir>(initialPrefs.sortDir)
const perPage = ref<PerPageOption>(initialPrefs.perPage)
const perPageOptions = computed(() => [
  { label: t('admin.common.perPage', { count: 10 }), value: '10' },
  { label: t('admin.common.perPage', { count: 25 }), value: '25' },
  { label: t('admin.common.perPage', { count: 50 }), value: '50' },
  { label: t('admin.common.perPage', { count: 100 }), value: '100' }
])
const statusCheckboxOptions = computed<Array<{ value: PostStatus, label: string }>>(() => [
  { value: 'draft', label: t('admin.posts.status.draft') },
  { value: 'published', label: t('admin.posts.status.published') },
  { value: 'archived', label: t('admin.posts.status.archived') }
])
const visibilityFilterOptions = computed<Array<{ value: PostVisibility, label: string }>>(() => [
  { value: 'public', label: t('admin.posts.visibility.public') },
  { value: 'private', label: t('admin.posts.visibility.private') },
  { value: 'password', label: t('admin.posts.visibility.password') }
])
const selectedTagIds = ref<string[]>([...initialPrefs.selectedTagIds])
const selectedCategoryIds = ref<string[]>([...initialPrefs.selectedCategoryIds])
const page = ref(1)
const perPageNumber = computed(() => Number(perPage.value))
const start = computed(() => (page.value - 1) * perPageNumber.value)
const titleRegexValid = computed(() => {
  const value = titleQuery.value.trim()
  if (!value) {
    return true
  }

  try {
    void new RegExp(value)
    return true
  } catch {
    return false
  }
})
const lengthMinNumber = computed(() => normalizeRangeInput(lengthMin.value))
const lengthMaxNumber = computed(() => normalizeRangeInput(lengthMax.value))
const postListQuery = computed(() => ({
  sort: `${sortKey.value}_${sortDir.value}`,
  limit: perPageNumber.value,
  start: start.value,
  ...(titleRegexValid.value && titleQuery.value.trim() ? { title: titleQuery.value.trim() } : {}),
  ...(selectedStatuses.value.length ? { statuses: selectedStatuses.value.join(',') } : {}),
  ...(selectedVisibilities.value.length ? { visibilities: selectedVisibilities.value.join(',') } : {}),
  ...(selectedTagIds.value.length ? { tag_ids: selectedTagIds.value.join(',') } : {}),
  ...(selectedCategoryIds.value.length ? { category_ids: selectedCategoryIds.value.join(',') } : {}),
  ...(lengthMinNumber.value !== null ? { length_min: lengthMinNumber.value } : {}),
  ...(lengthMaxNumber.value !== null ? { length_max: lengthMaxNumber.value } : {}),
  ...(publishedFrom.value ? { published_from: publishedFrom.value } : {}),
  ...(publishedTo.value ? { published_to: publishedTo.value } : {}),
  ...(updatedFrom.value ? { updated_from: updatedFrom.value } : {}),
  ...(updatedTo.value ? { updated_to: updatedTo.value } : {})
}))
const { data, pending, error, refresh } = await useAsyncData(
  'admin-posts',
  () => sessionFetch<{ posts: PostRecord[], total: number, limit: number, start: number }>('/api/admin/posts', {
    query: postListQuery.value
  }),
  { watch: [postListQuery] }
)
const { data: taxonomyData, error: taxonomyError, refresh: refreshTaxonomy } = await useAsyncData('admin-post-taxonomy-options', async () => {
  const [tagResponse, categoryResponse] = await Promise.all([
    sessionFetch<{ tags: TagRecord[] }>('/api/admin/tags'),
    sessionFetch<{ categories: CategoryRecord[] }>('/api/admin/categories')
  ])

  return {
    tags: tagResponse.tags,
    categories: categoryResponse.categories
  }
})

const posts = computed(() => data.value?.posts ?? [])
const totalPosts = computed(() => data.value?.total ?? 0)
const totalPages = computed(() => Math.max(1, Math.ceil(totalPosts.value / perPageNumber.value)))
const pageRangeLabel = computed(() => {
  if (!totalPosts.value) {
    return t('admin.posts.showingZero')
  }

  const first = start.value + 1
  const last = Math.min(start.value + posts.value.length, totalPosts.value)
  return t('admin.posts.showingRange', { first, last, total: totalPosts.value })
})
const tagOptions = computed(() => taxonomyData.value?.tags ?? [])
const categoryOptions = computed(() => taxonomyData.value?.categories ?? [])
const tagFilterOptions = computed(() => tagOptions.value.map((tag) => ({ id: tag.id, name: tag.name })))
const categoryFilterOptions = computed(() => flattenCategoryOptions(categoryOptions.value).map((entry) => ({
  id: entry.category.id,
  name: entry.category.name,
  level: entry.level
})))
const filteredTagOptions = computed(() => {
  const term = tagSearch.value.trim().toLowerCase()
  if (!term) {
    return tagFilterOptions.value
  }
  return tagFilterOptions.value.filter((option) => option.name.toLowerCase().includes(term))
})
const filteredCategoryOptions = computed(() => {
  const term = categorySearch.value.trim().toLowerCase()
  if (!term) {
    return categoryFilterOptions.value
  }
  return categoryFilterOptions.value.filter((option) => option.name.toLowerCase().includes(term))
})
const titleActive = computed(() => titleRegexValid.value && titleQuery.value.trim().length > 0)
const lengthActive = computed(() => lengthMinNumber.value !== null || lengthMaxNumber.value !== null)
const publishedActive = computed(() => Boolean(publishedFrom.value) || Boolean(publishedTo.value))
const updatedActive = computed(() => Boolean(updatedFrom.value) || Boolean(updatedTo.value))
const isArchivedView = computed(() => selectedStatuses.value.length === 1 && selectedStatuses.value[0] === 'archived')
const filtersActive = computed(() => titleActive.value
  || selectedStatuses.value.length > 0
  || selectedVisibilities.value.length > 0
  || selectedTagIds.value.length > 0
  || selectedCategoryIds.value.length > 0
  || lengthActive.value
  || publishedActive.value
  || updatedActive.value
  || sortKey.value !== ADMIN_POST_DEFAULT_SORT_KEY
  || sortDir.value !== ADMIN_POST_DEFAULT_SORT_DIR)

const adminPostListPrefsSnapshot = computed<AdminPostListPrefs>(() => ({
  titleQuery: titleQuery.value,
  tagSearch: tagSearch.value,
  categorySearch: categorySearch.value,
  selectedStatuses: [...selectedStatuses.value],
  selectedVisibilities: [...selectedVisibilities.value],
  selectedTagIds: [...selectedTagIds.value],
  selectedCategoryIds: [...selectedCategoryIds.value],
  lengthMin: lengthMin.value,
  lengthMax: lengthMax.value,
  publishedFrom: publishedFrom.value,
  publishedTo: publishedTo.value,
  updatedFrom: updatedFrom.value,
  updatedTo: updatedTo.value,
  sortKey: sortKey.value,
  sortDir: sortDir.value,
  perPage: perPage.value
}))

function persistAdminPostListPrefs() {
  if (!import.meta.client) {
    return
  }

  adminPostListPrefs.value = adminPostListPrefsSnapshot.value
  try {
    localStorage.setItem(ADMIN_POST_LIST_PREFS_STORAGE_KEY, JSON.stringify(adminPostListPrefs.value))
  } catch {}
}

function restoreAdminPostListPrefs() {
  if (!import.meta.client) {
    return
  }

  let raw: string | null = null
  try {
    raw = localStorage.getItem(ADMIN_POST_LIST_PREFS_STORAGE_KEY)
  } catch {
    return
  }

  const stored = parseAdminPostListPrefs(raw)
  titleQuery.value = stored.titleQuery
  tagSearch.value = stored.tagSearch
  categorySearch.value = stored.categorySearch
  selectedStatuses.value = [...stored.selectedStatuses]
  selectedVisibilities.value = [...stored.selectedVisibilities]
  selectedTagIds.value = [...stored.selectedTagIds]
  selectedCategoryIds.value = [...stored.selectedCategoryIds]
  lengthMin.value = stored.lengthMin
  lengthMax.value = stored.lengthMax
  publishedFrom.value = stored.publishedFrom
  publishedTo.value = stored.publishedTo
  updatedFrom.value = stored.updatedFrom
  updatedTo.value = stored.updatedTo
  sortKey.value = stored.sortKey
  sortDir.value = stored.sortDir
  perPage.value = stored.perPage
}

// Restore after hydration so SSR markup stays deterministic. The query watcher
// then refetches with the stored filters instead of the server defaults.
onMounted(restoreAdminPostListPrefs)

const adminToast = useAdminToast()
const bulkDeleting = ref(false)
const selectedIds = ref<string[]>([])
const quickEditEnabled = ref(false)
const editingCell = ref<{ postId: string, field: EditableField } | null>(null)
const savingCellKey = ref('')
const passwordDialogOpen = ref(false)
const pendingPasswordPost = ref<PostRecord | null>(null)
const draft = reactive({
  title: '',
  status: 'draft' as PostStatus,
  visibility: 'public' as PostVisibility,
  tagIds: [] as string[],
  categoryIds: [] as string[],
  tagNamesInput: '',
  categoryNamesInput: '',
  password: ''
})

const selectedIdSet = computed(() => new Set(selectedIds.value))
const allVisibleSelected = computed(() => posts.value.length > 0 && posts.value.every((post) => selectedIdSet.value.has(post.id)))
const someVisibleSelected = computed(() => !allVisibleSelected.value && posts.value.some((post) => selectedIdSet.value.has(post.id)))
const selectedPosts = computed(() => posts.value.filter((post) => selectedIdSet.value.has(post.id)))
const selectedIntent = computed<BulkIntent>(() => {
  if (!selectedPosts.value.length) {
    return 'archive'
  }

  const archivedCount = selectedPosts.value.filter((post) => post.status === 'archived').length
  if (archivedCount === selectedPosts.value.length) {
    return 'hard-delete'
  }

  if (archivedCount === 0) {
    return 'archive'
  }

  return 'mixed'
})
const selectedActionLabel = computed(() => {
  if (selectedIntent.value === 'hard-delete') {
    return t('admin.posts.actions.deletePermanently')
  }

  if (selectedIntent.value === 'mixed') {
    return t('admin.posts.actions.archiveDelete')
  }

  return t('admin.posts.actions.archive')
})

const confirmDialog = reactive({
  open: false,
  intent: 'archive' as BulkIntent,
  title: '',
  description: '',
  confirmLabel: t('admin.posts.actions.archive'),
  confirmColor: 'primary' as 'primary' | 'error' | 'neutral',
  ids: [] as string[]
})

interface EmbedUsagePost {
  id: string
  title: string
  slug: string
  status: string
}

/** Posts (non-archived) that embed the given post as a card or inline chip. */
async function fetchEmbedUsage(ids: string[]): Promise<Map<string, EmbedUsagePost[]>> {
  const usage = new Map<string, EmbedUsagePost[]>()
  await Promise.all(ids.map(async (id) => {
    try {
      const response = await $fetch<{ posts: EmbedUsagePost[] }>(`/api/admin/posts/${encodeURIComponent(id)}/usage`)
      if (response.posts?.length) usage.set(id, response.posts)
    } catch {
      // Non-fatal: the action may proceed without the warning.
    }
  }))
  return usage
}

function embedUsageLines(ids: string[], usage: Map<string, EmbedUsagePost[]>): string[] {
  return ids.flatMap((id) => {
    const referenced = usage.get(id)
    if (!referenced?.length) return []
    const targetTitle = posts.value.find((post) => post.id === id)?.title || id
    const referencing = referenced.map((post) => post.title).join(', ')
    return [t('admin.posts.embedUsage.warning', { title: targetTitle, posts: referencing })]
  })
}

function appendUsageWarning(ids: string[]) {
  const signature = [...ids].sort().join('|')
  void fetchEmbedUsage(ids).then((usage) => {
    if (!usage.size) return
    if (!confirmDialog.open || [...confirmDialog.ids].sort().join('|') !== signature) return
    const lines = embedUsageLines(ids, usage)
    if (lines.length) {
      confirmDialog.description = `${confirmDialog.description}\n\n${lines.join('\n')}`
    }
  })
}

/** Post-save notice for status changes to draft — non-blocking info toast. */
async function notifyEmbedUsage(ids: string[]) {
  const usage = await fetchEmbedUsage(ids)
  const lines = embedUsageLines(ids, usage)
  if (lines.length) {
    adminToast.info(t('admin.posts.embedUsage.noticeTitle'), lines.join('\n'))
  }
}

const actionsMenuItems = computed(() => [[
  ...(isArchivedView.value
    ? [
        {
          label: t('admin.posts.actions.restore'),
          icon: 'i-lucide-rotate-ccw',
          color: 'primary' as const,
          onSelect: restoreSelected
        },
        {
          label: t('admin.posts.actions.deletePermanently'),
          icon: 'i-lucide-trash-2',
          color: 'error' as const,
          onSelect: deletePermanentlySelected
        }
      ]
    : [
        {
          label: selectedActionLabel.value,
          icon: selectedIntent.value === 'archive' ? 'i-lucide-archive' : 'i-lucide-trash-2',
          color: selectedIntent.value === 'archive' ? ('primary' as const) : ('error' as const),
          onSelect: openBulkActionDialog
        },
        {
          label: t('admin.posts.actions.edit'),
          icon: 'i-lucide-square-pen',
          onSelect: editSelected
        },
        {
          label: quickEditEnabled.value ? t('admin.posts.actions.disableQuickEdit') : t('admin.posts.actions.quickEdit'),
          icon: quickEditEnabled.value ? 'i-lucide-square-x' : 'i-lucide-file-pen-line',
          onSelect: toggleQuickEdit
        }
      ])
]])

function postCardMenuItems(post: PostRecord) {
  return [[
    {
      label: t('admin.posts.actions.edit'),
      icon: 'i-lucide-square-pen',
      onSelect: () => openPost(post)
    },
    ...(post.status === 'archived'
      ? [
          {
            label: t('admin.posts.actions.restore'),
            icon: 'i-lucide-rotate-ccw',
            color: 'primary' as const,
            onSelect: () => runForSinglePost(post, restoreSelected)
          },
          {
            label: t('admin.posts.actions.deletePermanently'),
            icon: 'i-lucide-trash-2',
            color: 'error' as const,
            onSelect: () => runForSinglePost(post, deletePermanentlySelected)
          }
        ]
      : [
          {
            label: t('admin.posts.actions.archive'),
            icon: 'i-lucide-archive',
            color: 'primary' as const,
            onSelect: () => runForSinglePost(post, openBulkActionDialog)
          }
        ])
  ]]
}

function runForSinglePost(post: PostRecord, action: () => void | Promise<void>) {
  selectedIds.value = [post.id]
  void action()
}

watch(adminPostListPrefsSnapshot, persistAdminPostListPrefs)

watch([
  titleQuery,
  selectedStatuses,
  selectedVisibilities,
  selectedTagIds,
  selectedCategoryIds,
  lengthMin,
  lengthMax,
  publishedFrom,
  publishedTo,
  updatedFrom,
  updatedTo,
  sortKey,
  sortDir,
  perPage
], () => {
  page.value = 1
  selectedIds.value = []
  cancelCellEdit()
  closeConfirmDialog()
  if (isArchivedView.value && quickEditEnabled.value) {
    quickEditEnabled.value = false
    cancelCellEdit()
  }
})

watch(page, () => {
  selectedIds.value = []
  cancelCellEdit()
  closeConfirmDialog()
})

watch(totalPages, (next) => {
  if (page.value > next) {
    page.value = next
  }
})

async function createPost() {
  creating.value = true
  try {
    await navigateTo({ path: '/admin/posts/new', query: { new: '1' } })
  } catch (error: any) {
    adminToast.error(error, t('admin.posts.createFailed'))
    creating.value = false
  }
}

function onRowActivate(post: PostRecord) {
  if (quickEditEnabled.value) {
    startCellEdit(post, 'title')
    return
  }

  void openPost(post)
}

function onCellClick(post: PostRecord, field: EditableField, event: MouseEvent) {
  // Quick-edit ON: a tap edits that specific cell (and must not open the post).
  // Quick-edit OFF: let the click bubble to the row so a single tap opens it.
  if (!quickEditEnabled.value) {
    return
  }

  event.stopPropagation()
  startCellEdit(post, field)
}

async function openPost(post: PostRecord) {
  await navigateTo(`/admin/posts/${encodeURIComponent(post.id)}`)
}

function startCellEdit(post: PostRecord, field: EditableField) {
  if (!quickEditEnabled.value) {
    return
  }

  editingCell.value = { postId: post.id, field }
  draft.title = post.title
  draft.status = post.status === 'archived' ? 'draft' : post.status
  draft.visibility = post.visibility ?? 'public'
  draft.tagIds = post.tags?.map((tag) => tag.id) ?? post.tag_ids ?? []
  draft.categoryIds = post.categories?.map((category) => category.id) ?? post.category_ids ?? []
  draft.tagNamesInput = ''
  draft.categoryNamesInput = ''
  draft.password = ''

  nextTick(() => {
    const editorElement = document.querySelector(`[data-inline-editor="${inlineEditorKey(post.id, field)}"]`) as HTMLElement | null
    editorElement?.focus()

    if (editorElement instanceof HTMLInputElement) {
      editorElement.select()
    }
  })
}

function cancelCellEdit() {
  editingCell.value = null
  savingCellKey.value = ''
}

function isEditing(post: PostRecord, field: EditableField) {
  return editingCell.value?.postId === post.id && editingCell.value.field === field
}

function inlineEditorKey(postId: string, field: EditableField) {
  return `${postId}-${field}`
}

function isSavingPost(postId: string) {
  return savingCellKey.value.startsWith(`${postId}-`)
}

function postRowMemo(post: PostRecord) {
  const editing = editingCell.value?.postId === post.id
  return [
    post.id,
    post.title,
    post.status,
    post.visibility,
    post.published_at,
    post.updated_at,
    post.word_count,
    post.cjk_char_count,
    taxonomyMemoKey(post.tags),
    taxonomyMemoKey(post.categories),
    selectedIdSet.value.has(post.id),
    editing,
    editing ? editingCell.value?.field : '',
    isSavingPost(post.id)
  ]
}

function taxonomyMemoKey(items?: Array<TagRecord | CategoryRecord>) {
  return items?.map((item) => `${item.id}:${item.name}`).join('|') ?? ''
}

async function saveCurrentCell(options: { close?: boolean } = {}) {
  const cell = editingCell.value
  if (!cell) {
    return
  }

  const currentKey = inlineEditorKey(cell.postId, cell.field)
  if (savingCellKey.value === currentKey) {
    return
  }

  const post = posts.value.find((item) => item.id === cell.postId)
  if (!post) {
    editingCell.value = null
    return
  }

  const body = updateBodyForCell(cell.field)
  savingCellKey.value = currentKey

  try {
    const endpoint: string = `/api/admin/posts/${encodeURIComponent(cell.postId)}`
    await $fetch(endpoint, {
      method: 'PUT',
      body
    })

    const refreshTaxonomyOptions = Boolean(body.tag_names || body.category_names)
    if (refreshTaxonomyOptions) {
      await refreshTaxonomy()
    }
    await refresh()

    if (cell.field === 'status' && (draft.status === 'draft' || draft.status === 'archived')) {
      void notifyEmbedUsage([cell.postId])
    }

    if (options.close) {
      editingCell.value = null
    }
  } catch (error: any) {
    adminToast.error(error, t('admin.posts.updateFailed'))
  } finally {
    savingCellKey.value = ''
  }
}

function updateBodyForCell(field: EditableField): Record<string, unknown> {
  if (field === 'title') {
    return { title: draft.title }
  }

  if (field === 'status') {
    return { status: draft.status }
  }

  if (field === 'visibility') {
    return {
      visibility: draft.visibility,
      ...(draft.password ? { password: draft.password } : {})
    }
  }

  if (field === 'tags') {
    const tagNames = splitNames(draft.tagNamesInput)
    return {
      tag_ids: draft.tagIds,
      ...(tagNames.length ? { tag_names: tagNames } : {})
    }
  }

  const categoryNames = splitNames(draft.categoryNamesInput)
  return {
    category_ids: draft.categoryIds,
    ...(categoryNames.length ? { category_names: categoryNames } : {})
  }
}

async function handleVisibilityChange(post: PostRecord) {
  if (draft.visibility === 'password' && post.visibility !== 'password') {
    pendingPasswordPost.value = post
    passwordDialogOpen.value = true
    return
  }

  await saveCurrentCell({ close: true })
}

function cancelPasswordDialog() {
  const post = pendingPasswordPost.value
  passwordDialogOpen.value = false
  pendingPasswordPost.value = null
  draft.visibility = post?.visibility ?? 'public'
  editingCell.value = null
}

async function confirmPasswordDialog(password: string) {
  draft.password = password
  passwordDialogOpen.value = false
  pendingPasswordPost.value = null
  await saveCurrentCell({ close: true })
}

function handleVisibilityBlur() {
  if (passwordDialogOpen.value) {
    return
  }

  void saveCurrentCell({ close: true })
}

function handleCellFocusOut(event: FocusEvent) {
  const currentTarget = event.currentTarget as HTMLElement
  const nextTarget = event.relatedTarget as Node | null

  if (nextTarget && currentTarget.contains(nextTarget)) {
    return
  }

  void saveCurrentCell({ close: true })
}

function toggleSelectAll(event: Event) {
  const checked = (event.target as HTMLInputElement).checked

  if (checked) {
    selectedIds.value = Array.from(new Set([...selectedIds.value, ...posts.value.map((post) => post.id)]))
    return
  }

  const visibleIds = new Set(posts.value.map((post) => post.id))
  selectedIds.value = selectedIds.value.filter((postId) => !visibleIds.has(postId))
}

function openBulkActionDialog() {
  if (!selectedIds.value.length) {
    return
  }

  const uniqueIds = Array.from(new Set(selectedIds.value))
  const count = uniqueIds.length
  const intent = selectedIntent.value

  let title = ''
  let description = ''
  let confirmLabel = ''
  let confirmColor: 'primary' | 'error' | 'neutral' = 'primary'

  if (intent === 'hard-delete') {
    title = t(count === 1 ? 'admin.posts.bulk.deleteOneTitle' : 'admin.posts.bulk.deleteManyTitle', { count })
    description = t(count === 1 ? 'admin.posts.bulk.deleteOneDescription' : 'admin.posts.bulk.deleteManyDescription')
    confirmLabel = t(count === 1 ? 'admin.posts.bulk.deleteOneConfirm' : 'admin.posts.bulk.deleteManyConfirm', { count })
    confirmColor = 'error'
  } else if (intent === 'mixed') {
    title = t(count === 1 ? 'admin.posts.bulk.mixedOneTitle' : 'admin.posts.bulk.mixedManyTitle', { count })
    description = t('admin.posts.bulk.mixedDescription')
    confirmLabel = t('admin.common.continue')
    confirmColor = 'error'
  } else {
    title = t(count === 1 ? 'admin.posts.bulk.archiveOneTitle' : 'admin.posts.bulk.archiveManyTitle', { count })
    description = t(count === 1 ? 'admin.posts.bulk.archiveOneDescription' : 'admin.posts.bulk.archiveManyDescription')
    confirmLabel = t(count === 1 ? 'admin.posts.bulk.archiveOneConfirm' : 'admin.posts.bulk.archiveManyConfirm', { count })
    confirmColor = 'primary'
  }

  confirmDialog.open = true
  confirmDialog.intent = intent
  confirmDialog.title = title
  confirmDialog.description = description
  confirmDialog.confirmLabel = confirmLabel
  confirmDialog.confirmColor = confirmColor
  confirmDialog.ids = uniqueIds
  appendUsageWarning(uniqueIds)
}

function deletePermanentlySelected() {
  if (!selectedIds.value.length) {
    return
  }

  const uniqueIds = Array.from(new Set(selectedIds.value))
  const count = uniqueIds.length

  confirmDialog.open = true
  confirmDialog.intent = 'hard-delete'
  confirmDialog.title = t(count === 1 ? 'admin.posts.bulk.deleteOneTitle' : 'admin.posts.bulk.deleteManyTitle', { count })
  confirmDialog.description = t(count === 1 ? 'admin.posts.bulk.deleteOneDescription' : 'admin.posts.bulk.deleteManyDescription')
  confirmDialog.confirmLabel = t(count === 1 ? 'admin.posts.bulk.deleteOneConfirm' : 'admin.posts.bulk.deleteManyConfirm', { count })
  confirmDialog.confirmColor = 'error'
  confirmDialog.ids = uniqueIds
  appendUsageWarning(uniqueIds)
}

async function restoreSelected() {
  if (!selectedIds.value.length) {
    return
  }

  const uniqueIds = Array.from(new Set(selectedIds.value))
  bulkDeleting.value = true

  try {
    await Promise.all(uniqueIds.map((postId) => {
      const endpoint = `/api/admin/posts/${encodeURIComponent(postId)}`
      return $fetch(endpoint, {
        method: 'PUT',
        body: { status: 'draft' }
      })
    }))

    selectedIds.value = selectedIds.value.filter((postId) => !uniqueIds.includes(postId))
    if (editingCell.value && uniqueIds.includes(editingCell.value.postId)) {
      editingCell.value = null
    }
    await refresh()
    adminToast.success(t('admin.posts.bulk.restoredTitle'), t('admin.posts.bulk.restoredDescription', { count: uniqueIds.length }))
    void notifyEmbedUsage(uniqueIds)
  } catch (error: any) {
    adminToast.error(error, t('admin.posts.bulk.restoreFailed'))
  } finally {
    bulkDeleting.value = false
  }
}

function closeConfirmDialog() {
  if (bulkDeleting.value) {
    return
  }

  confirmDialog.open = false
  confirmDialog.ids = []
}

async function confirmBulkAction() {
  if (!confirmDialog.ids.length) {
    closeConfirmDialog()
    return
  }

  bulkDeleting.value = true
  try {
    await deletePosts(confirmDialog.ids)
  } finally {
    bulkDeleting.value = false
    closeConfirmDialog()
  }
}

async function editSelected() {
  if (!selectedIds.value.length) {
    return
  }

  const selectedId = selectedIds.value[0]
  if (!selectedId) {
    return
  }

  await navigateTo(`/admin/posts/${encodeURIComponent(selectedId)}`)
}

function toggleQuickEdit() {
  quickEditEnabled.value = !quickEditEnabled.value
  if (!quickEditEnabled.value) {
    cancelCellEdit()
  }
}

async function deletePosts(ids: string[]) {
  const uniqueIds = Array.from(new Set(ids))
  if (!uniqueIds.length) {
    return
  }

  try {
    const response = await $fetch<{
      archived: number
      deleted: number
      failed: number
      archived_ids: string[]
      deleted_ids: string[]
      failures: Array<{ id: string, message: string }>
    }>('/api/admin/posts/bulk', {
      method: 'DELETE',
      body: {
        ids: uniqueIds
      }
    })

    const processedIds = new Set([...(response.archived_ids ?? []), ...(response.deleted_ids ?? [])])

    selectedIds.value = selectedIds.value.filter((postId) => !processedIds.has(postId))
    if (editingCell.value && processedIds.has(editingCell.value.postId)) {
      editingCell.value = null
    }

    const processed = Number(response.archived ?? 0) + Number(response.deleted ?? 0)
    if (processed > 0) {
      adminToast.success(t('admin.posts.bulk.updatedTitle'), bulkPostResultDescription(response.archived, response.deleted))
    }

    if (response.failed > 0) {
      const firstFailure = response.failures?.[0]?.message ?? t('admin.posts.bulk.partialFailedFallback')
      adminToast.error(new Error(t('admin.posts.bulk.partialFailedMessage', { count: response.failed, message: firstFailure })), t('admin.posts.bulk.partialFailedTitle'))
    }

    await refresh()
  } catch (error: any) {
    adminToast.error(error, t('admin.posts.bulk.processFailed'))
  }
}

function bulkPostResultDescription(archived: number, deleted: number) {
  const parts = []
  if (archived > 0) {
    parts.push(t('admin.posts.bulk.resultArchived', { count: archived }))
  }
  if (deleted > 0) {
    parts.push(t('admin.posts.bulk.resultDeleted', { count: deleted }))
  }
  return `${parts.join(', ')}.`
}

function splitNames(value: string) {
  return Array.from(new Set(
    value
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
  ))
}

function clearFilters() {
  titleQuery.value = ''
  tagSearch.value = ''
  categorySearch.value = ''
  selectedStatuses.value = []
  selectedVisibilities.value = []
  selectedTagIds.value = []
  selectedCategoryIds.value = []
  lengthMin.value = ''
  lengthMax.value = ''
  publishedFrom.value = ''
  publishedTo.value = ''
  updatedFrom.value = ''
  updatedTo.value = ''
  sortKey.value = ADMIN_POST_DEFAULT_SORT_KEY
  sortDir.value = ADMIN_POST_DEFAULT_SORT_DIR
  page.value = 1
}

function setSort(key: SortKey, dir: SortDir) {
  sortKey.value = key
  sortDir.value = dir
}

function normalizeRangeInput(value: string): number | null {
  const raw = value.trim()
  if (!raw) {
    return null
  }
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? Math.max(Math.trunc(parsed), 0) : null
}

function goToPage(nextPage: number) {
  page.value = Math.min(Math.max(nextPage, 1), totalPages.value)
}

function flattenCategoryOptions(categories: CategoryRecord[]) {
  const categoryMap = new Map(categories.map((category) => [category.id, category]))
  const nonDefaultCategories = categories.filter((category) => category.slug !== 'default')
  const childrenByParent = new Map<string | null, CategoryRecord[]>()
  const rows: Array<{ category: CategoryRecord, level: number }> = []

  for (const category of nonDefaultCategories) {
    const parentId = category.parent_id && categoryMap.has(category.parent_id) && categoryMap.get(category.parent_id)?.slug !== 'default'
      ? category.parent_id
      : null
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), category])
  }

  for (const children of childrenByParent.values()) {
    children.sort((left, right) => left.name.localeCompare(right.name))
  }

  for (const category of categories.filter((item) => item.slug === 'default').sort((left, right) => left.name.localeCompare(right.name))) {
    rows.push({ category, level: 0 })
  }

  appendCategoryRows(null, 0)
  return rows

  function appendCategoryRows(parentId: string | null, level: number) {
    for (const category of childrenByParent.get(parentId) ?? []) {
      rows.push({ category, level })
      appendCategoryRows(category.id, level + 1)
    }
  }
}

function visibilityLabel(value: PostVisibility | undefined) {
  if (value === 'private') {
    return t('admin.posts.visibility.private')
  }

  if (value === 'password') {
    return t('admin.posts.visibility.password')
  }

  return t('admin.posts.visibility.public')
}

function statusLabel(value: PostStatus) {
  return t(`admin.posts.status.${value}`)
}

function visibilityIcon(value: PostVisibility | undefined) {
  if (value === 'private') {
    return 'i-lucide-eye-off'
  }

  if (value === 'password') {
    return 'i-lucide-lock'
  }

  return 'i-lucide-globe-2'
}

function formatDate(value: string | null | undefined, fallback: string) {
  return formatAdminDate(value, fallback)
}

function formatContentLength(post: PostRecord) {
  const words = Number(post.word_count ?? 0)
  const cjk = Number(post.cjk_char_count ?? 0)
  if (!words && !cjk) return '—'
  const parts: string[] = []
  if (cjk) parts.push(t('admin.posts.contentLength.chars', { count: formatAdminNumber(cjk) }))
  if (words) parts.push(t('admin.posts.contentLength.words', { count: formatAdminNumber(words) }))
  return parts.join(' · ')
}
</script>
