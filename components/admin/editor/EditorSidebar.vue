<template>
  <aside data-testid="editor-sidebar-panel" class="flex flex-col bg-[var(--pb-card-bg)]">
    <div class="flex-1 overflow-y-auto p-4">
      <EditorVersionsPanel
        v-if="mode === 'versions'"
        :versions="versions ?? []"
        @close="$emit('closeVersions')"
        @diff="$emit('diffVersion', $event)"
        @restore="$emit('restoreVersion', $event)"
        @delete="$emit('deleteVersion', $event)"
      />
      <BlockSettings v-else :editor="editor" />
    </div>
  </aside>
</template>

<script setup lang="ts">
import type { Editor } from '@tiptap/core'
import type { PostVersionListItem } from '~/types/editor'
// Explicit import: Nuxt auto-registers nested components with a path prefix
// (`AdminEditorBlockSettings`), so the short `<BlockSettings>` tag below
// would otherwise fail to resolve.
import BlockSettings from '~/components/admin/editor/blocks/BlockSettings.vue'
import EditorVersionsPanel from '~/components/admin/editor/EditorVersionsPanel.vue'

defineProps<{
  editor: Editor | null
  mode?: 'settings' | 'versions'
  versions?: PostVersionListItem[]
}>()

defineEmits<{
  closeVersions: []
  diffVersion: [version: PostVersionListItem]
  restoreVersion: [version: PostVersionListItem]
  deleteVersion: [version: PostVersionListItem]
}>()
</script>