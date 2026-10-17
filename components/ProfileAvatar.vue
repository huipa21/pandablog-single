<template>
  <span class="grid shrink-0 place-items-center overflow-hidden rounded-full bg-[var(--pb-selected-bg)] text-xs font-semibold text-[var(--pb-primary)]" :title="ownerName">
    <img v-if="avatarUrl" :src="avatarUrl" :alt="ownerName" class="h-full w-full object-cover">
    <span v-else>{{ initials }}</span>
  </span>
</template>

<script setup lang="ts">
const { ownerName, ownerAvatar } = useSiteSettings()
const { resolveMediaUrl } = useMediaUrl()
const avatarUrl = computed(() => resolveMediaUrl(ownerAvatar.value))
const initials = computed(() => {
  const parts = ownerName.value.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : ownerName.value.slice(0, 2)
  return letters.toUpperCase() || 'U'
})
</script>
