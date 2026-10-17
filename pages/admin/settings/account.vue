<template>
  <section />
</template>

<script setup lang="ts">
definePageMeta({ layout: 'admin' })
await navigateTo('/admin/settings/profile', { replace: true, redirectCode: 301 })
</script>
