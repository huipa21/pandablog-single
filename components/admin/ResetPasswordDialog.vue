<template>
  <UModal
    v-model:open="open"
    :title="t('admin.settings.profile.resetPassword')"
    :description="t('admin.settings.profile.resetPasswordDescription')"
    :dismissible="!saving"
    :close="!saving"
  >
    <template #body>
      <form :id="formId" class="grid gap-5" @submit.prevent="resetPassword">
        <UAlert v-if="passwordMismatch" color="error" icon="i-lucide-circle-alert" :title="t('public.profile.passwordMismatch')" />
        <UFormField :label="t('public.profile.currentPassword')" name="current_password">
          <UInput v-model="form.current_password" type="password" autocomplete="current-password" icon="i-lucide-key-round" required />
        </UFormField>
        <UFormField :label="t('public.profile.newPassword')" name="new_password">
          <UInput v-model="form.new_password" type="password" autocomplete="new-password" icon="i-lucide-key-round" required />
        </UFormField>
        <UFormField :label="t('public.profile.confirmNewPassword')" name="confirm_password">
          <UInput v-model="form.confirm_password" type="password" autocomplete="new-password" icon="i-lucide-key-round" required />
        </UFormField>
      </form>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton color="neutral" variant="ghost" :disabled="saving" @click="open = false">{{ t('admin.common.cancel') }}</UButton>
        <UButton type="submit" :form="formId" icon="i-lucide-key-round" :loading="saving">{{ t('admin.settings.profile.resetPassword') }}</UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })
const { t } = useI18n()
const adminToast = useAdminToast()
const formId = useId()
const saving = ref(false)
const passwordMismatch = ref(false)
const form = reactive({
  current_password: '',
  new_password: '',
  confirm_password: ''
})

watch(open, () => {
  form.current_password = ''
  form.new_password = ''
  form.confirm_password = ''
  passwordMismatch.value = false
})

async function resetPassword() {
  if (saving.value) return
  passwordMismatch.value = form.new_password !== form.confirm_password
  if (passwordMismatch.value) return

  saving.value = true
  try {
    await $fetch('/api/auth/change-password', {
      method: 'POST',
      body: { ...form }
    })
    open.value = false
    adminToast.success(t('public.profile.passwordChanged'))
    await refreshNuxtData(['public-auth-session', 'admin-layout-session'])
    await navigateTo('/login')
  } catch (error: unknown) {
    adminToast.error(error, t('public.profile.passwordChangeFailed'))
  } finally {
    saving.value = false
  }
}
</script>
