<template>
  <section class="grid gap-6">
    <header>
      <p class="text-sm font-medium uppercase tracking-wider text-[var(--pb-link)]">{{ t('admin.settings.common.eyebrow') }}</p>
      <h1 class="mt-1 text-3xl font-semibold tracking-normal text-[var(--pb-text)]">{{ t('admin.settings.profile.title') }}</h1>
      <p class="mt-2 max-w-2xl text-sm text-[var(--pb-text-muted)]">{{ t('admin.settings.profile.description') }}</p>
    </header>

    <UAlert v-if="error" color="error" icon="i-lucide-circle-alert" :title="t('admin.settings.common.loadFailed')" />

    <form class="grid gap-5 rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] p-5 shadow-[var(--pb-shadow-sm)]" @submit.prevent="save">
      <div v-if="pending" class="grid gap-4">
        <USkeleton class="h-10" />
        <USkeleton class="h-10" />
        <USkeleton class="h-80" />
      </div>

      <template v-else>
        <UFormField :label="t('admin.settings.profile.displayName')" name="owner_name">
          <UInput v-model="form.owner_name" icon="i-lucide-user" />
        </UFormField>

        <UFormField :label="t('admin.settings.profile.motto')" name="owner_motto">
          <UInput v-model="form.owner_motto" icon="i-lucide-sparkles" />
        </UFormField>

        <MediaSettingField
          :label="t('admin.settings.profile.avatar')"
          :model-value="form.owner_avatar"
          preview-container-class="w-fit rounded-full"
          preview-image-class="size-32 rounded-full object-cover"
          @update:model-value="form.owner_avatar = $event"
          @browse="mediaPickerOpen = true"
        />

        <fieldset class="rounded-[var(--pb-radius-card-inner)] border border-[var(--pb-divider)] p-4">
          <legend class="px-1 text-sm font-medium text-[var(--pb-text-muted)]">{{ t('admin.settings.profile.sidebarVisibility') }}</legend>
          <label class="flex cursor-pointer items-center justify-between gap-4 text-sm">
            <span class="grid gap-1">
              <span class="font-medium text-[var(--pb-text)]">{{ t('admin.settings.profile.showInSidebar') }}</span>
              <span class="text-xs text-[var(--pb-text-muted)]">{{ t('admin.settings.profile.hideBioHelp') }}</span>
            </span>
            <USwitch v-model="form.owner_bio_visible" />
          </label>
        </fieldset>

        <UFormField :label="t('admin.settings.profile.bio')" name="owner_bio">
          <div class="rounded-[var(--pb-radius-card-inner)] border border-[var(--pb-divider)] bg-[var(--pb-card-bg)] p-3">
            <BlockEditor v-model="form.owner_bio" />
          </div>
        </UFormField>

        <div class="flex justify-end">
          <UButton type="submit" icon="i-lucide-save" :loading="saving">{{ t('admin.settings.profile.saveProfile') }}</UButton>
        </div>
      </template>
    </form>

    <AccountSettings />

    <MediaPicker
      :open="mediaPickerOpen"
      return-value="url"
      type-filter="image"
      @update:open="mediaPickerOpen = $event"
      @select="handleAvatarPicked"
    />

    <AdminConfirmActionDialog
      :open="squareAvatarDialogOpen"
      :title="t('admin.settings.profile.squareAvatarTitle')"
      :description="t('admin.settings.profile.squareAvatarDescription')"
      :confirm-label="t('admin.settings.profile.useAvatarAsIs')"
      :cancel-label="t('admin.settings.profile.chooseDifferentAvatar')"
      confirm-color="primary"
      @update:open="(value) => { if (!value) cancelSquareAvatar() }"
      @cancel="cancelSquareAvatar"
      @confirm="confirmSquareAvatar"
    />
  </section>
</template>

<script setup lang="ts">
import MediaPicker from '~/components/admin/media/MediaPicker.vue'
import MediaSettingField from '~/components/admin/media/MediaSettingField.vue'
import BlockEditor from '~/components/admin/editor/blocks/BlockEditor.vue'
import AccountSettings from '~/components/admin/AccountSettings.vue'
import type { JsonContent, MediaRecord } from '~/types/content'

definePageMeta({ layout: 'admin' })

const { t } = useI18n()
const sessionFetch = useSessionFetch()
const { data, pending, error } = await useAsyncData('admin-settings-profile', () => sessionFetch<{ settings: Record<string, unknown> }>('/api/admin/settings'))

const form = reactive({
  owner_name: '',
  owner_motto: '',
  owner_avatar: '',
  owner_bio_visible: true,
  owner_bio: emptyDoc()
})
const mediaPickerOpen = ref(false)
const squareAvatarDialogOpen = ref(false)
const pendingSquareAvatarUrl = ref('')
const saving = ref(false)
const adminToast = useAdminToast()

watch(data, (value) => {
  const settings = value?.settings ?? {}
  form.owner_name = textValue(settings.owner_name)
  form.owner_motto = textValue(settings.owner_motto)
  form.owner_avatar = textValue(settings.owner_avatar)
  form.owner_bio_visible = settings.owner_bio_visible !== false
  form.owner_bio = jsonContentValue(settings.owner_bio) ?? emptyDoc()
}, { immediate: true })

async function save() {
  saving.value = true

  try {
    await $fetch('/api/admin/settings', {
      method: 'POST',
      body: {
        owner_name: form.owner_name,
        owner_motto: form.owner_motto,
        owner_avatar: form.owner_avatar,
        owner_bio_visible: form.owner_bio_visible,
        owner_bio: form.owner_bio
      }
    })
    await refreshNuxtData(['public-bootstrap', 'admin-layout-settings'])
    adminToast.success(t('admin.settings.profile.saved'))
  } catch (err: any) {
    adminToast.error(err, t('admin.settings.profile.saveFailed'))
  } finally {
    saving.value = false
  }
}

function handleAvatarPicked(files: MediaRecord[]) {
  const file = files[0]
  if (file?.url) {
    if (isSquareImage(file)) {
      pendingSquareAvatarUrl.value = file.url
      squareAvatarDialogOpen.value = true
    } else {
      form.owner_avatar = file.url
    }
  }
  mediaPickerOpen.value = false
}

function confirmSquareAvatar() {
  if (pendingSquareAvatarUrl.value) {
    form.owner_avatar = pendingSquareAvatarUrl.value
  }
  closeSquareAvatarDialog()
}

function cancelSquareAvatar() {
  closeSquareAvatarDialog()
  mediaPickerOpen.value = true
}

function closeSquareAvatarDialog() {
  pendingSquareAvatarUrl.value = ''
  squareAvatarDialogOpen.value = false
}

function isSquareImage(file: MediaRecord) {
  const width = file.width ?? file.image_meta?.width
  const height = file.height ?? file.image_meta?.height
  return typeof width === 'number' && width > 0 && width === height
}

function emptyDoc(): JsonContent {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [] }]
  }
}

function textValue(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function jsonContentValue(value: unknown): JsonContent | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const node = value as JsonContent
  return typeof node.type === 'string' ? node : null
}
</script>
