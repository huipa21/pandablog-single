<template>
  <div class="grid gap-2">
    <label :for="inputId" class="text-sm font-medium text-[var(--pb-text-muted)]">{{ label }}</label>
    <div v-if="previewSource" class="relative overflow-hidden rounded-[var(--pb-radius-card-inner)] border border-[var(--pb-divider)] bg-[var(--pb-surface-subtle)]" :class="previewContainerClass">
      <img v-if="!previewFailed" :src="previewSource" :alt="label" class="bg-[var(--pb-surface-subtle)]" :class="previewImageClass || [previewClass || 'h-36', 'w-full', 'object-cover']" :style="previewStyle" @error="previewFailed = true">
      <div v-else class="flex flex-col items-center justify-center gap-2 bg-[var(--pb-surface-subtle)] px-4 py-8 text-center text-[var(--pb-text-subtle)]" :class="previewImageClass || [previewClass || 'h-36', 'w-full']" :style="previewStyle">
        <UIcon name="i-lucide-image-off" class="size-8" />
        <span class="text-sm font-medium">{{ placeholder || label }}</span>
      </div>
      <button
        type="button"
        class="absolute right-2 top-2 rounded-full border border-[var(--pb-divider)] bg-[var(--pb-card-bg)]/90 p-1 shadow-[var(--pb-shadow-sm)] hover:bg-[var(--pb-card-bg)]"
        @click="emit('update:modelValue', '')"
      >
        <UIcon name="i-lucide-x" class="size-4 text-[var(--pb-text-muted)]" />
      </button>
    </div>
    <div class="grid gap-2 md:grid-cols-[1fr_auto]">
      <UInput
        :id="inputId"
        :model-value="modelValue"
        icon="i-lucide-link"
        :placeholder="placeholder || '/uploads/... or https://...'"
        @update:model-value="emit('update:modelValue', String($event ?? ''))"
      />
      <UButton type="button" icon="i-lucide-image-plus" variant="soft" @click="emit('browse')">
        Choose
      </UButton>
    </div>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  label: string
  modelValue: string
  previewValue?: string
  placeholder?: string
  previewContainerClass?: string
  previewClass?: string
  previewImageClass?: string
  previewStyle?: Record<string, string>
}>()

const inputId = useId()
const previewSource = computed(() => props.previewValue || props.modelValue)
const previewFailed = ref(false)

watch(previewSource, () => {
  previewFailed.value = false
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  browse: []
}>()
</script>
