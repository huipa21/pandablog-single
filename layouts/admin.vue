<template>
  <div class="pb-admin-shell">
    <!-- Top bar -->
    <header
      class="fixed inset-x-0 top-0 z-30"
      :class="hideSidebar ? 'md:left-0' : (collapsed ? 'md:left-[68px]' : 'md:left-64')"
    >
      <div class="pb-admin-topbar flex h-14 items-center justify-between px-4 md:px-6">
        <div class="flex min-w-0 items-center gap-3">
          <button
            v-if="!hideSidebar"
            data-testid="admin-mobile-menu-button"
            class="grid size-10 place-items-center rounded-[var(--pb-radius-md)] text-[var(--pb-text-muted)] md:hidden"
            :aria-label="t('admin.layout.openNavigation')"
            @click="sidebarOpen = !sidebarOpen"
          >
            <UIcon name="i-lucide-menu" class="size-5" />
          </button>
          <nav v-if="breadcrumbs.length" class="hidden min-w-0 items-center gap-1 text-sm text-[var(--pb-text-subtle)] xl:flex" aria-label="Admin breadcrumbs">
            <template v-for="(crumb, index) in breadcrumbs" :key="`${crumb.label}-${index}`">
              <NuxtLink
                v-if="index < breadcrumbs.length - 1 && crumb.to"
                :to="crumb.to"
                class="max-w-40 truncate rounded-[var(--pb-radius-sm)] px-2 py-1 transition hover:bg-[var(--pb-surface-subtle)] hover:text-[var(--pb-text)]"
              >
                {{ crumb.label }}
              </NuxtLink>
              <span v-else-if="index < breadcrumbs.length - 1" class="max-w-40 truncate px-2 py-1">
                {{ crumb.label }}
              </span>
              <span v-else class="max-w-52 truncate px-2 py-1 font-medium text-[var(--pb-text)]">
                {{ crumb.label }}
              </span>
              <UIcon v-if="index < breadcrumbs.length - 1" name="i-lucide-chevron-right" class="size-4 shrink-0" />
            </template>
          </nav>
        </div>
        <div class="flex items-center gap-2">
          <div class="hidden md:block">
            <BlogSearchBar :key="`admin-search-${locale}`" variant="header" />
          </div>
          <UDropdownMenu v-if="isLoggedIn" :items="quickNewItems">
            <UButton
              type="button"
              variant="ghost"
              color="neutral"
              icon="i-lucide-plus"
              size="sm"
              :loading="creatingQuickPost"
              :aria-label="t('public.nav.new')"
              :title="t('public.nav.new')"
            >
              {{ t('public.nav.new') }}
            </UButton>
          </UDropdownMenu>
          <UButton
            to="/"
            variant="ghost"
            color="neutral"
            icon="i-lucide-external-link"
            size="sm"
            :aria-label="t('admin.layout.viewSite')"
            :title="t('admin.layout.viewSite')"
          >
            <span class="hidden lg:inline">{{ t('admin.layout.viewSite') }}</span>
          </UButton>
          <UButton
            variant="ghost"
            color="neutral"
            :icon="themeModeIcon"
            :aria-label="themeModeLabel"
            :title="themeModeLabel"
            size="sm"
            :loading="themeModeSaving"
            @click="toggleThemeMode"
          />
          <UDropdownMenu :items="accountMenuItems">
            <button type="button" class="flex h-10 max-w-48 items-center gap-2 rounded-[var(--pb-radius-lg)] px-2 text-sm font-medium text-[var(--pb-text)] transition hover:bg-[var(--pb-surface-subtle)]" :disabled="loggingOut">
              <span class="grid size-8 place-items-center overflow-hidden rounded-full bg-[var(--pb-selected-bg)] text-xs font-semibold text-[var(--pb-primary)]">
                <img v-if="accountAvatarUrl" :src="accountAvatarUrl" alt="" class="h-full w-full object-cover">
                <span v-else>{{ accountInitials }}</span>
              </span>
              <span class="hidden truncate sm:inline">{{ accountName }}</span>
              <UIcon name="i-lucide-chevron-down" class="hidden size-4 shrink-0 text-[var(--pb-text-subtle)] sm:block" />
            </button>
          </UDropdownMenu>
        </div>
      </div>
    </header>

    <!-- Sidebar overlay (mobile) -->
    <div v-if="!hideSidebar && sidebarOpen" class="fixed inset-0 z-40 bg-black/30 md:hidden" @click="sidebarOpen = false" />

    <!-- Sidebar drawer -->
    <aside
      v-if="!hideSidebar"
      class="pb-admin-sidebar fixed inset-y-0 left-0 z-50 flex w-64 flex-col px-3 py-4 transition-[width,transform] duration-200 ease-out"
      :class="[
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        collapsed ? 'md:w-[68px]' : 'md:w-64',
        'md:translate-x-0'
      ]"
    >
      <NuxtLink
        to="/admin/dashboard"
        class="mb-4 flex h-12 items-center gap-3 rounded-[var(--pb-radius-lg)] bg-[var(--pb-surface-subtle)] px-3 text-[var(--pb-text)]"
        :class="collapsed ? 'md:justify-center md:px-0' : ''"
        :title="collapsed ? siteName : undefined"
        @click="closeIfMobile"
      >
        <img v-if="siteLogo" :src="siteLogo" alt="" class="h-7 w-7 shrink-0">
        <PandaLogo v-else :size="28" class="text-[var(--pb-primary)]" />
        <span class="min-w-0 flex-1 truncate font-semibold md:hidden">{{ siteName }}</span>
        <span v-if="!collapsed" class="hidden min-w-0 flex-1 truncate font-semibold md:inline">{{ siteName }}</span>
      </NuxtLink>

      <nav class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto pr-1">
        <template v-for="section in navSections" :key="section.label || 'root'">
          <div
            v-if="section.label"
            class="mt-4 mb-1 px-3 text-xs font-medium text-[var(--pb-text-subtle)] md:hidden"
          >
            {{ section.label }}
          </div>
          <div
            v-if="section.label && !collapsed"
            class="mt-4 mb-1 hidden px-3 text-xs font-medium text-[var(--pb-text-subtle)] md:block"
          >
            {{ section.label }}
          </div>
          <div
            v-if="section.label && collapsed"
            class="mx-2 my-3 hidden border-t border-[var(--pb-border)] md:block"
            aria-hidden="true"
          />
          <NuxtLink
            v-for="item in section.items"
            :key="item.to"
            :to="item.to"
            class="group flex min-h-11 items-center gap-3 rounded-[var(--pb-radius-lg)] px-3 text-sm font-medium transition"
            :class="[
              collapsed ? 'md:justify-center md:px-0' : '',
              isActiveNav(item.to)
                ? 'bg-[var(--pb-selected-bg)] text-[var(--pb-primary)]'
                : 'text-[var(--pb-text-muted)] hover:bg-[var(--pb-surface-subtle)] hover:text-[var(--pb-text)]'
            ]"
            :title="collapsed ? item.label : undefined"
            @click="closeIfMobile"
          >
            <UIcon :name="item.icon" class="size-5 shrink-0" />
            <span class="min-w-0 flex-1 truncate md:hidden">{{ item.label }}</span>
            <span v-if="!collapsed" class="hidden min-w-0 flex-1 truncate md:inline">{{ item.label }}</span>
          </NuxtLink>
        </template>
      </nav>

      <button
        type="button"
        class="mt-3 hidden h-10 items-center gap-2 rounded-[var(--pb-radius-lg)] px-3 text-sm font-medium text-[var(--pb-text-muted)] transition hover:bg-[var(--pb-surface-subtle)] hover:text-[var(--pb-text)] md:flex"
        :class="collapsed ? 'md:justify-center md:px-0' : ''"
        :aria-label="collapsed ? t('admin.layout.expandSidebar') : t('admin.layout.collapseSidebar')"
        :title="collapsed ? t('admin.layout.expandSidebar') : t('admin.layout.collapseSidebar')"
        @click="toggleCollapsed"
      >
        <UIcon :name="collapsed ? 'i-lucide-chevrons-right' : 'i-lucide-chevrons-left'" class="size-5 shrink-0" />
        <span v-if="!collapsed">{{ t('admin.layout.collapse') }}</span>
      </button>
    </aside>

    <!-- Main content -->
    <div class="pt-14" :class="hideSidebar ? '' : (collapsed ? 'md:pl-[68px]' : 'md:pl-64')">
      <main :class="mainClass">
        <slot />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ADMIN_LOCALE_KEY, DEFAULT_ADMIN_LOCALE, normalizeAdminLocale } from '~/utils/adminLocale'
import { ADMIN_COLOR_MODE_KEY, DEFAULT_ADMIN_COLOR_MODE } from '~/utils/themeMode'

const ADMIN_POST_DISPLAY_MODE_KEY = 'admin_post_display_mode'

interface AdminSessionUser {
  id: string
  username: string
  display_name?: string | null
  avatar_url?: string | null
}

const { t, locale, setLocale } = useI18n()
const { siteName, siteLogo, siteFavicon } = useSiteSettings()
const { resolveMediaUrl } = useMediaUrl()
const adminFavicon = computed(() => resolveMediaUrl(siteFavicon.value))
useHead(() => ({
  link: [
    { rel: 'icon', key: 'favicon', href: adminFavicon.value || '/favicon.ico' }
  ]
}))
const sessionFetch = useSessionFetch()
const { data: authSession } = await useAsyncData('admin-layout-session', () => sessionFetch<{ loggedIn: boolean, user: AdminSessionUser | null }>('/api/auth/session'), {
  default: () => ({ loggedIn: false, user: null })
})
const isLoggedIn = computed(() => Boolean(authSession.value?.user))
const defaultAdminSettings = () => ({ settings: { [ADMIN_COLOR_MODE_KEY]: DEFAULT_ADMIN_COLOR_MODE, [ADMIN_LOCALE_KEY]: DEFAULT_ADMIN_LOCALE, [ADMIN_POST_DISPLAY_MODE_KEY]: 'slug' } })
const { data: adminSettings } = await useAsyncData('admin-layout-settings', () => {
  if (!isLoggedIn.value) {
    return Promise.resolve(defaultAdminSettings())
  }

  return sessionFetch<{ settings: Record<string, unknown> }>('/api/admin/settings')
}, {
  default: defaultAdminSettings
})
await setLocale(normalizeAdminLocale(adminSettings.value?.settings?.[ADMIN_LOCALE_KEY]) ?? DEFAULT_ADMIN_LOCALE)

watch(() => adminSettings.value?.settings?.[ADMIN_LOCALE_KEY], async (value) => {
  await setLocale(normalizeAdminLocale(value) ?? DEFAULT_ADMIN_LOCALE)
})
const {
  toggleIcon: themeModeIcon,
  toggleLabel: themeModeLabel,
  saving: themeModeSaving,
  toggleThemeMode
} = useThemeMode({
  defaultMode: DEFAULT_ADMIN_COLOR_MODE,
  initialMode: () => adminSettings.value?.settings?.[ADMIN_COLOR_MODE_KEY],
  persist: async (mode) => {
    if (!isLoggedIn.value) {
      return
    }

    const response = await $fetch<{ settings: Record<string, unknown> }>('/api/admin/settings', {
      method: 'POST',
      body: { [ADMIN_COLOR_MODE_KEY]: mode }
    })
    adminSettings.value = response
  }
})
const route = useRoute()
const hideSidebar = computed(() => route.meta.adminHideSidebar === true)

const sidebarOpen = ref(false)
const loggingOut = ref(false)
const mainClass = computed(() => route.meta.adminWide === true ? 'min-w-0' : 'min-w-0 px-4 py-8 md:px-8')
const accountUser = computed(() => authSession.value?.user ?? null)
const accountName = computed(() => accountUser.value?.display_name || accountUser.value?.username || t('admin.layout.account'))
const accountAvatarUrl = computed(() => accountUser.value?.avatar_url || '')
const accountInitials = computed(() => initialsFor(accountName.value))
const adminToast = useAdminToast()
const creatingQuickPost = ref(false)
const quickNewItems = computed(() => [[
  { label: t('public.nav.newPost'), icon: 'i-lucide-file-plus-2', disabled: creatingQuickPost.value, onSelect: createQuickPost },
  { label: t('public.nav.newMedia'), icon: 'i-lucide-upload', onSelect: openMediaUploader }
]])
const accountMenuItems = computed(() => [[
  { label: t('admin.layout.myProfile'), icon: 'i-lucide-user', onSelect: () => navigateTo('/admin/settings/account') }
], [
  { label: t('admin.layout.signOut'), icon: 'i-lucide-log-out', color: 'error' as const, onSelect: logout }
]])

const STORAGE_KEY = 'pb-admin-sidebar-collapsed'
const AUTO_COLLAPSE_BREAKPOINT = 1280
const userPreference = ref<boolean | null>(null)
const autoCollapsed = ref(false)
const collapsed = computed(() => userPreference.value ?? autoCollapsed.value)

function toggleCollapsed() {
  userPreference.value = !collapsed.value
  if (import.meta.client) {
    try {
      localStorage.setItem(STORAGE_KEY, userPreference.value ? '1' : '0')
    } catch {}
  }
}

function closeIfMobile() {
  sidebarOpen.value = false
}

function syncAutoCollapse() {
  if (!import.meta.client) return
  autoCollapsed.value = window.innerWidth < AUTO_COLLAPSE_BREAKPOINT
}

onMounted(() => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === '0' || stored === '1') {
      userPreference.value = stored === '1'
    }
  } catch {}
  syncAutoCollapse()
  window.addEventListener('resize', syncAutoCollapse)
})

onBeforeUnmount(() => {
  if (import.meta.client) {
    window.removeEventListener('resize', syncAutoCollapse)
  }
})

const navSections = computed(() => {
  const dashboardItems = [
    { to: '/admin/dashboard', label: t('admin.nav.dashboard'), icon: 'i-lucide-layout-dashboard' }
  ]

  const sections = [
    {
      label: '',
      items: dashboardItems
    }
  ]

  sections.push({
    label: t('admin.nav.posts'),
    items: [
      { to: '/admin/posts', label: t('admin.nav.posts'), icon: 'i-lucide-file-text' },
      { to: '/admin/categories', label: t('admin.nav.categories'), icon: 'i-lucide-folder' },
      { to: '/admin/tags', label: t('admin.nav.tags'), icon: 'i-lucide-tags' },
      { to: '/admin/media', label: t('admin.nav.mediaLibrary'), icon: 'i-lucide-image' }
    ]
  })

  sections.push({
    label: t('admin.nav.settings'),
    items: [
      { to: '/admin/settings/general', label: t('admin.nav.general'), icon: 'i-lucide-sliders-horizontal' },
      { to: '/admin/settings/profile', label: t('admin.nav.profile'), icon: 'i-lucide-user' },
      { to: '/admin/settings/account', label: t('admin.nav.account'), icon: 'i-lucide-user-cog' },
      { to: '/admin/settings/themes', label: t('admin.nav.themes'), icon: 'i-lucide-palette' },
      { to: '/admin/settings/analytics', label: t('admin.nav.analyticsSettings'), icon: 'i-lucide-chart-no-axes-combined' },
      { to: '/admin/settings/security', label: t('admin.nav.security'), icon: 'i-lucide-shield-check' },
      { to: '/admin/settings/system', label: t('admin.nav.system'), icon: 'i-lucide-monitor-cog' }
    ]
  })

  sections.push({
    label: t('admin.nav.tools'),
    items: [
      { to: '/admin/backups', label: t('admin.nav.backups'), icon: 'i-lucide-database-backup' }
    ]
  })

  return sections
})

const breadcrumbLabels = computed<Record<string, string>>(() => ({
  admin: t('admin.nav.dashboard'),
  dashboard: t('admin.nav.dashboard'),
  posts: t('admin.nav.posts'),
  categories: t('admin.nav.categories'),
  tags: t('admin.nav.tags'),
  media: t('admin.nav.mediaLibrary'),
  settings: t('admin.nav.settings'),
  account: t('admin.nav.account'),
  general: t('admin.nav.general'),
  site: t('admin.nav.site'),
  profile: t('admin.nav.profile'),
  footer: t('admin.nav.footer'),
  visibility: t('admin.nav.visibility'),
  themes: t('admin.nav.themes'),
  analytics: t('admin.nav.analytics'),
  system: t('admin.nav.system'),
  logs: t('admin.nav.logs'),
  backups: t('admin.nav.backups'),
  activity: t('admin.nav.activity'),
  errors: t('admin.nav.errors'),
  setup: t('admin.nav.setup'),
  login: t('admin.nav.login')
}))

type AdminPostDisplayMode = 'slug' | 'id'

const adminPostBreadcrumb = useState<{ id: string, slug: string } | null>('admin-post-breadcrumb', () => null)
const adminPostDisplayMode = computed<AdminPostDisplayMode>(() => adminSettings.value?.settings?.[ADMIN_POST_DISPLAY_MODE_KEY] === 'id' ? 'id' : 'slug')

interface AdminBreadcrumb {
  to?: string
  label: string
}

const breadcrumbs = computed<AdminBreadcrumb[]>(() => {
  const parts = route.path.split('/').filter(Boolean)
  if (parts[0] !== 'admin' || parts.length <= 1) {
    return []
  }

  const firstSegment = parts[1]
  if (!firstSegment) {
    return []
  }

  if (firstSegment === 'dashboard') {
    const crumbs: AdminBreadcrumb[] = [{ to: '/admin/dashboard', label: t('admin.nav.dashboard') }]
    for (let index = 2; index < parts.length; index += 1) {
      const part = parts[index]
      if (!part) {
        continue
      }
      crumbs.push({
        to: `/${parts.slice(0, index + 1).join('/')}`,
        label: breadcrumbLabels.value[part] ?? decodeURIComponent(part).replace(/[-_]/g, ' ')
      })
    }
    return crumbs
  }

  const section = breadcrumbSection(firstSegment)
  const visiblePartsStart = firstSegment === 'settings' ? 2 : 1
  const visibleParts = parts.slice(visiblePartsStart)
  const crumbs: AdminBreadcrumb[] = section ? [{ label: section }] : []

  for (let index = 0; index < visibleParts.length; index += 1) {
    const part = visibleParts[index]
    if (!part) {
      continue
    }
    crumbs.push({
      to: `/${parts.slice(0, visiblePartsStart + index + 1).join('/')}`,
      label: breadcrumbLabel(part)
    })
  }

  return crumbs
})

function breadcrumbLabel(part: string) {
  const decoded = decodeURIComponent(part)
  if (decoded.startsWith('post:')) {
    const postLabel = adminPostDisplayMode.value === 'slug'
      ? adminPostBreadcrumb.value?.slug
      : adminPostBreadcrumb.value?.id
    return stripPostRecordPrefix(postLabel || decoded)
  }

  return breadcrumbLabels.value[part] ?? decoded.replace(/[-_]/g, ' ')
}

function stripPostRecordPrefix(value: string) {
  return value.startsWith('post:') ? value.slice(5) : value
}

function breadcrumbSection(part: string) {
  if (['posts', 'categories', 'tags', 'media'].includes(part)) return t('admin.nav.posts')
  if (part === 'settings') return t('admin.nav.settings')
  if (part === 'backups') return t('admin.nav.tools')
  return ''
}

function isActiveNav(to: string) {
  if (to === '/admin/dashboard') return route.path === '/admin' || route.path === to
  return route.path === to || route.path.startsWith(`${to}/`)
}

async function createQuickPost() {
  if (creatingQuickPost.value) return

  creatingQuickPost.value = true
  try {
    const post = await $fetch<{ id: string }>('/api/admin/posts', {
      method: 'POST',
      body: { title: '' }
    })
    await navigateTo({ path: `/admin/posts/${encodeURIComponent(post.id)}`, query: { new: '1' } })
  } catch (error: unknown) {
    adminToast.error(error, t('admin.posts.createFailed'))
  } finally {
    creatingQuickPost.value = false
  }
}

function openMediaUploader() {
  return navigateTo({ path: '/admin/media', query: { upload: '1' } })
}

async function logout() {
  loggingOut.value = true
  try {
    await $fetch('/api/auth/logout', { method: 'POST' })
    await navigateTo('/login')
  } finally {
    loggingOut.value = false
  }
}

function initialsFor(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}` : value.slice(0, 2)
  return letters.toUpperCase() || 'U'
}
</script>
