<template>
  <section class="grid gap-6">
    <header>
      <p class="text-sm font-medium uppercase tracking-wider text-[var(--pb-link)]">{{ t('admin.settings.analytics.eyebrow') }}</p>
      <h1 class="mt-1 text-3xl font-semibold tracking-normal text-[var(--pb-text)]">{{ t('admin.settings.analytics.title') }}</h1>
      <p class="mt-2 max-w-2xl text-sm text-[var(--pb-text-muted)]">{{ t('admin.settings.analytics.description') }}</p>
    </header>

    <UAlert v-if="error" color="error" icon="i-lucide-circle-alert" :title="t('admin.settings.analytics.saveFailed')" />

    <form class="grid gap-5 rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] p-5 shadow-[var(--pb-shadow-sm)]" @submit.prevent="save">
      <div v-if="pending" class="grid gap-4">
        <USkeleton class="h-10" />
        <USkeleton class="h-10" />
        <USkeleton class="h-10" />
      </div>

      <template v-else>
        <fieldset class="space-y-3 rounded-[var(--pb-radius-card-inner)] border border-[var(--pb-divider)] p-4">
          <legend class="text-sm font-medium text-[var(--pb-text-muted)]">{{ t('admin.settings.analytics.collectionTitle') }}</legend>
          <label class="flex items-start gap-3">
            <input v-model="form.analytics_enabled" type="checkbox" class="mt-1 rounded border-[var(--pb-border-strong)]">
            <span>
              <span class="block text-sm font-medium text-[var(--pb-text)]">{{ t('admin.settings.analytics.enableCollection') }}</span>
              <span class="block text-xs text-[var(--pb-text-muted)]">{{ t('admin.settings.analytics.enableCollectionHelp') }}</span>
            </span>
          </label>
        </fieldset>

        <div class="grid gap-4 md:grid-cols-2">
          <UFormField :label="t('admin.settings.analytics.sessionWindow')" :description="t('admin.settings.analytics.sessionWindowHelp')" name="analytics_session_window_minutes">
            <UInput v-model.number="form.analytics_session_window_minutes" type="number" min="5" max="1440" icon="i-lucide-clock-3" class="w-full" />
          </UFormField>

          <UFormField :label="t('admin.settings.analytics.retentionDays')" :description="t('admin.settings.analytics.retentionDaysHelp')" name="analytics_retention_days">
            <UInput v-model.number="form.analytics_retention_days" type="number" min="7" max="3650" icon="i-lucide-trash-2" class="w-full" />
          </UFormField>
        </div>

        <div class="flex justify-end">
          <UButton type="submit" icon="i-lucide-save" :loading="saving">{{ t('common.save') }}</UButton>
        </div>
      </template>
    </form>
  </section>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'admin' })

const { t } = useI18n()
const sessionFetch = useSessionFetch()
const { data, pending, error } = await useAsyncData('admin-settings-analytics', () => sessionFetch<{ settings: Record<string, unknown> }>('/api/admin/settings'))
const adminToast = useAdminToast()
const saving = ref(false)
const form = reactive({
  analytics_enabled: false,
  analytics_session_window_minutes: 30,
  analytics_retention_days: 90
})

watch(data, (value) => {
  const settings = value?.settings ?? {}
  form.analytics_enabled = settings.analytics_enabled === true
  form.analytics_session_window_minutes = numberSetting(settings.analytics_session_window_minutes, 30)
  form.analytics_retention_days = numberSetting(settings.analytics_retention_days, 90)
}, { immediate: true })

async function save() {
  saving.value = true

  try {
    const response = await $fetch<{ settings: Record<string, unknown> }>('/api/admin/settings', {
      method: 'POST',
      body: {
        analytics_enabled: form.analytics_enabled,
        analytics_session_window_minutes: form.analytics_session_window_minutes,
        analytics_retention_days: form.analytics_retention_days
      }
    })
    data.value = response
    adminToast.success(t('admin.settings.analytics.saved'))
  } catch (err: any) {
    adminToast.error(err, t('admin.settings.analytics.saveFailed'))
  } finally {
    saving.value = false
  }
}

function numberSetting(value: unknown, fallback: number) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : fallback
}
</script>
