<template>
  <section class="grid gap-6">
    <header>
      <p class="text-sm font-medium uppercase tracking-wider text-[var(--pb-link)]">{{ t('admin.settings.common.eyebrow') }}</p>
      <h1 class="mt-1 text-3xl font-semibold tracking-normal text-[var(--pb-text)]">{{ t('public.profile.title') }}</h1>
    </header>

    <UAlert v-if="loadError" color="error" icon="i-lucide-circle-alert" :title="t('public.profile.loadFailed')" />
    <UAlert v-if="profileError" color="error" icon="i-lucide-circle-alert" :title="profileError" />
    <UAlert v-if="passwordError" color="error" icon="i-lucide-circle-alert" :title="passwordError" />
    <UAlert v-if="profileNotice" color="success" icon="i-lucide-check" :title="profileNotice" />
    <UAlert v-if="passwordNotice" color="success" icon="i-lucide-check" :title="passwordNotice" />

    <form class="grid gap-5 rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] p-5 shadow-[var(--pb-shadow-sm)]" @submit.prevent="saveProfile">
      <div v-if="pending" class="grid gap-4">
        <USkeleton class="h-10" />
        <USkeleton class="h-10" />
        <USkeleton class="h-40" />
      </div>

      <template v-else>
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField :label="t('public.profile.displayName')" name="display_name">
            <UInput v-model="profileForm.display_name" autocomplete="name" icon="i-lucide-badge" />
          </UFormField>
          <UFormField :label="t('public.profile.email')" name="email">
            <UInput v-model="profileForm.email" type="email" autocomplete="email" icon="i-lucide-mail" />
          </UFormField>
        </div>

        <MediaSettingField
          :label="t('public.profile.avatar')"
          :model-value="profileForm.avatar"
          :preview-value="avatarPreviewUrl"
          :placeholder="t('public.profile.avatarPlaceholder')"
          preview-container-class="w-fit rounded-full"
          preview-image-class="size-36 rounded-full object-cover"
          @update:model-value="profileForm.avatar = normalizeAvatarValue($event)"
          @browse="avatarPickerOpen = true"
        />

        <div class="flex justify-end">
          <UButton type="submit" icon="i-lucide-save" :loading="profileSaving">{{ t('public.profile.saveProfile') }}</UButton>
        </div>
      </template>
    </form>

    <form class="grid gap-5 rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] p-5 shadow-[var(--pb-shadow-sm)]" @submit.prevent="changePassword">
      <header>
        <h2 class="text-xl font-semibold tracking-normal text-[var(--pb-text)]">{{ t('public.profile.passwordTitle') }}</h2>
      </header>

      <UFormField :label="t('public.profile.currentPassword')" name="current_password">
        <UInput v-model="passwordForm.current_password" type="password" autocomplete="current-password" icon="i-lucide-key-round" />
      </UFormField>
      <UFormField :label="t('public.profile.newPassword')" name="new_password">
        <UInput v-model="passwordForm.new_password" type="password" autocomplete="new-password" icon="i-lucide-key-round" />
      </UFormField>
      <UFormField :label="t('public.profile.confirmNewPassword')" name="confirm_password">
        <UInput v-model="passwordForm.confirm_password" type="password" autocomplete="new-password" icon="i-lucide-key-round" />
      </UFormField>

      <div class="flex justify-end">
        <UButton type="submit" icon="i-lucide-key-round" :loading="passwordSaving">{{ t('public.profile.changePassword') }}</UButton>
      </div>
    </form>

    <MediaPicker
      :open="avatarPickerOpen"
      return-value="hash"
      type-filter="image"
      @update:open="avatarPickerOpen = $event"
      @select="handleAvatarPicked"
    />

    <AdminConfirmActionDialog
      :open="squareAvatarDialogOpen"
      :title="t('public.profile.squareAvatarTitle')"
      :description="t('public.profile.squareAvatarDescription')"
      :confirm-label="t('public.profile.useAvatarAsIs')"
      :cancel-label="t('public.profile.chooseDifferentAvatar')"
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
import type { MediaRecord } from '~/types/content'

interface AccountUser {
  id: string
  username: string
  display_name: string | null
  email: string | null
  avatar: string | null
  avatar_url: string | null
}

definePageMeta({ layout: 'admin' })

const { t } = useI18n()
const { data, pending, error: loadError } = await useAsyncData('admin-account-me', () => $fetch<{ user: AccountUser }>('/api/auth/me'), {
  default: () => ({ user: null as unknown as AccountUser })
})

const profileForm = reactive({
  display_name: '',
  email: '',
  avatar: ''
})
const passwordForm = reactive({
  current_password: '',
  new_password: '',
  confirm_password: ''
})
const avatarPickerOpen = ref(false)
const squareAvatarDialogOpen = ref(false)
const pendingSquareAvatarId = ref('')
const profileSaving = ref(false)
const passwordSaving = ref(false)
const profileNotice = ref('')
const profileError = ref('')
const passwordNotice = ref('')
const passwordError = ref('')

watch(data, (value) => {
  const user = value?.user
  profileForm.display_name = user?.display_name ?? ''
  profileForm.email = user?.email ?? ''
  profileForm.avatar = user?.avatar ?? ''
}, { immediate: true })

const avatarPreviewUrl = computed(() => avatarUrl(profileForm.avatar) || data.value?.user?.avatar_url || '')

async function saveProfile() {
  profileSaving.value = true
  profileNotice.value = ''
  profileError.value = ''

  try {
    const response = await $fetch<{ user: AccountUser }>('/api/auth/me', {
      method: 'PUT',
      body: {
        display_name: profileForm.display_name,
        email: profileForm.email,
        avatar: profileForm.avatar
      }
    })
    data.value = response
    await refreshNuxtData(['public-auth-session', 'admin-layout-session'])
    profileNotice.value = t('public.profile.profileSaved')
  } catch (error: any) {
    profileError.value = error?.data?.message ?? error?.message ?? t('public.profile.profileSaveFailed')
  } finally {
    profileSaving.value = false
  }
}

async function changePassword() {
  passwordSaving.value = true
  passwordNotice.value = ''
  passwordError.value = ''

  if (passwordForm.new_password !== passwordForm.confirm_password) {
    passwordError.value = t('public.profile.passwordMismatch')
    passwordSaving.value = false
    return
  }

  try {
    await $fetch('/api/auth/change-password', {
      method: 'POST',
      body: { ...passwordForm }
    })
    passwordForm.current_password = ''
    passwordForm.new_password = ''
    passwordForm.confirm_password = ''
    passwordNotice.value = t('public.profile.passwordChanged')
    await refreshNuxtData(['public-auth-session', 'admin-layout-session'])
  } catch (error: any) {
    passwordError.value = error?.data?.message ?? error?.message ?? t('public.profile.passwordChangeFailed')
  } finally {
    passwordSaving.value = false
  }
}

function handleAvatarPicked(files: MediaRecord[]) {
  const file = files[0]
  if (!file?.id) return

  if (isSquareImage(file)) {
    pendingSquareAvatarId.value = file.id
    squareAvatarDialogOpen.value = true
    return
  }

  profileForm.avatar = file.id
}

function confirmSquareAvatar() {
  if (pendingSquareAvatarId.value) {
    profileForm.avatar = pendingSquareAvatarId.value
  }
  closeSquareAvatarDialog()
}

function cancelSquareAvatar() {
  closeSquareAvatarDialog()
  avatarPickerOpen.value = true
}

function closeSquareAvatarDialog() {
  pendingSquareAvatarId.value = ''
  squareAvatarDialogOpen.value = false
}

function isSquareImage(file: MediaRecord) {
  const width = file.width ?? file.image_meta?.width
  const height = file.height ?? file.image_meta?.height
  return typeof width === 'number' && width > 0 && width === height
}

function normalizeAvatarValue(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('files:')) return trimmed
  if (/^[a-f0-9]{64}$/i.test(trimmed)) return `files:${trimmed.toLowerCase()}`
  return ''
}

function avatarUrl(value: string) {
  const normalized = normalizeAvatarValue(value)
  if (!normalized) return ''
  if (normalized.startsWith('http://') || normalized.startsWith('https://') || normalized.startsWith('/')) return normalized
  if (normalized.startsWith('files:')) return `/media/${encodeURIComponent(normalized.slice('files:'.length))}`
  return ''
}
</script>
