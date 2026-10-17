<template>
  <div v-if="ownerBioVisible && hasProfile" class="rounded-[var(--pb-radius-card-outer)] border border-[var(--pb-card-border)] bg-[var(--pb-card-bg)] p-4 shadow-[var(--pb-shadow-sm)]">
    <div class="flex items-center gap-3">
      <ProfileAvatar class="size-12" />
      <div>
        <div class="font-semibold text-[var(--pb-text)]">{{ ownerName }}</div>
        <div v-if="ownerMotto" class="mt-0.5 text-xs text-[var(--pb-text-subtle)]">{{ ownerMotto }}</div>
      </div>
    </div>
    <div v-if="rawOwnerBio" class="prose prose-stone mt-3 max-w-none text-sm leading-relaxed">
      <ContentRenderer :node="rawOwnerBio" />
    </div>
  </div>
</template>

<script setup lang="ts">
const { ownerName, ownerBio, ownerAvatar, ownerMotto, ownerBioVisible } = useSiteSettings()
const hasProfile = computed(() => Boolean(ownerName.value || ownerBio.value || ownerAvatar.value || ownerMotto.value))
const rawOwnerBio = computed(() => ownerBio.value ? markRaw(toRaw(ownerBio.value)) : null)
</script>
