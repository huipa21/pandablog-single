<template>
  <section class="grid gap-6">
    <header>
      <h2 class="text-xl font-semibold tracking-normal text-[var(--pb-text)]">{{ t('admin.nav.account') }}</h2>
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
  </section>
</template>

<script setup lang="ts">
interface AccountUser {
  id: string
  username: string
  display_name: string | null
  email: string | null
}

const { t } = useI18n()
const sessionFetch = useSessionFetch()
const { data, pending, error: loadError } = await useAsyncData('admin-account-me', () => sessionFetch<{ user: AccountUser }>('/api/auth/me'))

const profileForm = reactive({
  display_name: '',
  email: ''
})
const passwordForm = reactive({
  current_password: '',
  new_password: '',
  confirm_password: ''
})
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
}, { immediate: true })

async function saveProfile() {
  profileSaving.value = true
  profileNotice.value = ''
  profileError.value = ''

  try {
    const response = await $fetch<{ user: AccountUser }>('/api/auth/me', {
      method: 'PUT',
      body: {
        display_name: profileForm.display_name,
        email: profileForm.email
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
</script>
