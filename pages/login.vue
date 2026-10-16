<template>
  <main class="login-page">
    <img src="/defaults/site-banner.jpg" alt="" class="login-page__image">
    <div class="login-page__overlay" aria-hidden="true" />

    <section class="login-panel" aria-labelledby="login-title">
      <PandaLogo :size="64" class="login-panel__logo" />
      <h1 id="login-title" class="login-panel__title">{{ t('admin.nav.login') }}</h1>

      <form v-if="step === 'credentials'" class="login-form" @submit.prevent="login">
        <label class="login-field">
          <span>{{ t('public.login.username') }}</span>
          <input
            v-model="username"
            class="login-input"
            type="text"
            autocomplete="username"
            required
            autofocus
          >
        </label>

        <label class="login-field">
          <span>{{ t('public.login.password') }}</span>
          <input
            v-model="password"
            class="login-input"
            type="password"
            autocomplete="current-password"
            required
          >
        </label>

        <p v-if="errorMessage" class="login-error" role="alert">{{ errorMessage }}</p>

        <button class="login-submit" type="submit" :disabled="loading" :aria-busy="loading">
          {{ t('public.login.submit') }}
        </button>
      </form>

      <form v-else-if="step === 'mfa'" class="login-form" @submit.prevent="verifyMfa">
        <p class="login-hint">{{ t('public.login.mfa.prompt') }}</p>

        <label class="login-field">
          <span>{{ t('public.login.mfa.code') }}</span>
          <input
            v-model="mfaCode"
            class="login-input"
            type="text"
            inputmode="text"
            autocomplete="one-time-code"
            autocapitalize="characters"
            required
            autofocus
          >
        </label>

        <label class="login-check">
          <input v-model="trustDevice" type="checkbox">
          <span>{{ t('public.login.mfa.trustDevice') }}</span>
        </label>

        <p v-if="errorMessage" class="login-error" role="alert">{{ errorMessage }}</p>

        <button class="login-submit" type="submit" :disabled="loading" :aria-busy="loading">
          {{ t('public.login.mfa.verify') }}
        </button>
        <button class="login-link" type="button" @click="resetToCredentials">
          {{ t('public.login.mfa.back') }}
        </button>
      </form>

      <form v-else-if="step === 'enroll'" class="login-form" @submit.prevent="activateEnroll">
        <p class="login-hint">{{ t('public.login.mfa.enrollPrompt') }}</p>

        <img v-if="enrollQr" :src="enrollQr" :alt="t('public.login.mfa.qrAlt')" class="login-qr">
        <p v-if="enrollSecret" class="login-secret">
          <span>{{ t('public.login.mfa.secret') }}</span>
          <code>{{ enrollSecret }}</code>
        </p>

        <label class="login-field">
          <span>{{ t('public.login.mfa.code') }}</span>
          <input
            v-model="mfaCode"
            class="login-input"
            type="text"
            inputmode="text"
            autocomplete="one-time-code"
            autocapitalize="characters"
            required
            autofocus
          >
        </label>

        <label class="login-check">
          <input v-model="trustDevice" type="checkbox">
          <span>{{ t('public.login.mfa.trustDevice') }}</span>
        </label>

        <p v-if="errorMessage" class="login-error" role="alert">{{ errorMessage }}</p>

        <button class="login-submit" type="submit" :disabled="loading || !enrollSecret" :aria-busy="loading">
          {{ t('public.login.mfa.enable') }}
        </button>
        <button class="login-link" type="button" @click="resetToCredentials">
          {{ t('public.login.mfa.back') }}
        </button>
      </form>

      <div v-else-if="step === 'enroll-codes'" class="login-form">
        <p class="login-hint">{{ t('public.login.mfa.codesPrompt') }}</p>
        <ul class="login-codes">
          <li v-for="code in backupCodes" :key="code"><code>{{ code }}</code></li>
        </ul>
        <button class="login-submit" type="button" @click="finishEnrollment">
          {{ t('public.login.mfa.codesContinue') }}
        </button>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { resolveLoginRedirect, safeInternalPath } from '~/utils/authRedirect'

definePageMeta({ layout: false })

interface LoginUser {
  id: string
  username: string
}

const route = useRoute()
const { t } = useI18n()
const username = ref('')
const password = ref('')
const loading = ref(false)
const errorMessage = ref('')

type LoginStep = 'credentials' | 'mfa' | 'enroll' | 'enroll-codes'
const step = ref<LoginStep>('credentials')
const mfaCode = ref('')
const enrollQr = ref('')
const enrollSecret = ref('')
const backupCodes = ref<string[]>([])
const pendingUser = ref<LoginUser | null>(null)
const trustDevice = ref(false)

onMounted(async () => {
  const setup = await $fetch<{ completed: boolean }>('/api/auth/setup-status').catch(() => null)
  if (setup && !setup.completed) {
    await navigateTo({ path: '/admin/setup', query: { redirect: redirectTarget() } })
    return
  }

  const session = await $fetch<{ loggedIn: boolean, user: LoginUser | null }>('/api/auth/session').catch(() => null)
  if (session?.loggedIn && session.user) {
    await navigateAfterLogin()
  }
})

async function login() {
  loading.value = true
  errorMessage.value = ''

  try {
    const response = await $fetch<{
      user?: LoginUser
      mfa_required?: boolean
      mfa_enrollment_required?: boolean
    }>('/api/auth/login', {
      method: 'POST',
      body: {
        username: username.value,
        password: password.value
      }
    })

    if (response.mfa_required) {
      mfaCode.value = ''
      step.value = 'mfa'
      return
    }
    if (response.mfa_enrollment_required) {
      await startEnrollment()
      return
    }
    if (response.user) {
      await navigateAfterLogin()
    }
  } catch (error: any) {
    errorMessage.value = error?.data?.message ?? error?.statusMessage ?? t('public.login.invalid')
  } finally {
    loading.value = false
  }
}

async function verifyMfa() {
  loading.value = true
  errorMessage.value = ''

  try {
    await $fetch<{ user: LoginUser }>('/api/auth/login/mfa', {
      method: 'POST',
      body: { code: mfaCode.value, trustDevice: trustDevice.value }
    })
    await navigateAfterLogin()
  } catch (error: any) {
    errorMessage.value = error?.data?.message ?? error?.statusMessage ?? t('public.login.mfa.invalid')
  } finally {
    loading.value = false
  }
}

async function startEnrollment() {
  mfaCode.value = ''
  enrollQr.value = ''
  enrollSecret.value = ''
  step.value = 'enroll'
  try {
    const response = await $fetch<{ secret: string, otpauth: string, qr: string }>('/api/admin/auth/mfa/setup', {
      method: 'POST', body: {}
    })
    enrollSecret.value = response.secret
    enrollQr.value = response.qr
  } catch (error: any) {
    errorMessage.value = error?.data?.message ?? error?.statusMessage ?? t('public.login.mfa.invalid')
  }
}

async function activateEnroll() {
  loading.value = true
  errorMessage.value = ''

  try {
    const response = await $fetch<{ enabled: boolean, backup_codes: string[], user?: LoginUser }>(
      '/api/admin/auth/mfa/activate',
      {
        method: 'POST',
        body: { code: mfaCode.value, trustDevice: trustDevice.value }
      }
    )
    backupCodes.value = response.backup_codes ?? []
    pendingUser.value = response.user ?? null
    step.value = 'enroll-codes'
  } catch (error: any) {
    errorMessage.value = error?.data?.message ?? error?.statusMessage ?? t('public.login.mfa.invalid')
  } finally {
    loading.value = false
  }
}

async function finishEnrollment() {
  if (pendingUser.value) {
    await navigateAfterLogin()
    return
  }
  resetToCredentials()
}

function resetToCredentials() {
  step.value = 'credentials'
  mfaCode.value = ''
  trustDevice.value = false
  enrollQr.value = ''
  enrollSecret.value = ''
  backupCodes.value = []
  pendingUser.value = null
  errorMessage.value = ''
}

function redirectTarget() {
  return safeInternalPath(route.query.redirect, '/')
}

async function navigateAfterLogin() {
  await refreshNuxtData(['public-auth-session', 'admin-layout-session'])
  await navigateTo(resolveLoginRedirect(route.query.redirect))
}
</script>

<style scoped>
.login-page {
  position: relative;
  isolation: isolate;
  display: grid;
  min-height: 100vh;
  place-items: center;
  overflow: hidden;
  padding: clamp(1rem, 5vw, 3rem);
  background: var(--pb-hero-bg);
  color: var(--pb-text);
}

.login-page__image {
  position: absolute;
  inset: 0;
  z-index: -3;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
}

.login-page__overlay {
  position: absolute;
  inset: 0;
  z-index: -2;
  background:
    radial-gradient(circle at 50% 28%, color-mix(in srgb, var(--pb-surface) 58%, transparent), transparent 34rem),
    linear-gradient(135deg, color-mix(in srgb, var(--pb-hero-bg) 54%, transparent), color-mix(in srgb, var(--pb-primary) 24%, transparent)),
    color-mix(in srgb, var(--pb-app-bg) 18%, transparent);
}

.login-panel {
  width: min(100%, 25rem);
  min-height: min(32rem, calc(100vh - 2rem));
  display: grid;
  align-content: center;
  gap: 2.5rem;
  padding: clamp(2rem, 5vw, 3rem);
  border: 1px solid color-mix(in srgb, var(--pb-border-strong) 68%, transparent);
  border-radius: calc(var(--pb-radius-card-outer) + 0.75rem);
  background: color-mix(in srgb, var(--pb-surface) 54%, transparent);
  box-shadow: 0 1.5rem 5rem color-mix(in srgb, var(--pb-card-shadow-color) 72%, transparent);
  backdrop-filter: blur(22px) saturate(120%);
}

.login-panel__logo {
  margin: 0 auto -1.25rem;
  color: var(--pb-primary);
}

.login-panel__title {
  margin: 0;
  color: var(--pb-text);
  font-family: var(--pb-font-display);
  font-size: clamp(2rem, 8vw, 2.75rem);
  font-weight: 650;
  line-height: 1;
  text-align: center;
}

.login-form {
  display: grid;
  gap: 1.75rem;
}

.login-hint {
  margin: 0;
  color: color-mix(in srgb, var(--pb-text) 86%, transparent);
  font-size: 0.95rem;
  line-height: 1.5;
  text-align: center;
}

.login-qr {
  width: min(13rem, 60vw);
  justify-self: center;
  border-radius: var(--pb-radius-card-inner, 0.75rem);
  background: white;
  padding: 0.5rem;
}

.login-secret {
  display: grid;
  gap: 0.25rem;
  margin: 0;
  text-align: center;
  font-size: 0.85rem;
}

.login-secret code,
.login-codes code {
  font-family: var(--pb-font-mono, monospace);
  letter-spacing: 0.08em;
  word-break: break-all;
}

.login-codes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem 1rem;
  margin: 0;
  padding: 1rem;
  list-style: none;
  border: 1px solid color-mix(in srgb, var(--pb-border-strong) 60%, transparent);
  border-radius: var(--pb-radius-card-inner, 0.75rem);
  background: color-mix(in srgb, var(--pb-surface) 40%, transparent);
  text-align: center;
}

.login-link {
  margin-top: -0.75rem;
  border: 0;
  background: transparent;
  color: color-mix(in srgb, var(--pb-text) 80%, transparent);
  cursor: pointer;
  font: inherit;
  font-size: 0.875rem;
  text-decoration: underline;
}

.login-link:hover,
.login-link:focus-visible {
  color: var(--pb-text);
}

.login-field {
  display: grid;
  gap: 0.45rem;
  color: var(--pb-text);
  font-size: 0.95rem;
  font-weight: 650;
}

.login-check {
  display: grid;
  grid-template-columns: 1.1rem minmax(0, 1fr);
  gap: 0.65rem;
  align-items: start;
  margin-top: -0.5rem;
  color: color-mix(in srgb, var(--pb-text) 82%, transparent);
  cursor: pointer;
  font-size: 0.9rem;
  line-height: 1.45;
}

.login-check input {
  width: 1.1rem;
  height: 1.1rem;
  margin: 0.12rem 0 0;
  accent-color: var(--pb-primary);
}

.login-input {
  width: 100%;
  min-width: 0;
  height: 3rem;
  padding: 0.25rem 0 0.6rem;
  border: 0;
  border-bottom: 2px solid color-mix(in srgb, var(--pb-text) 62%, transparent);
  border-radius: 0;
  outline: 0;
  background: transparent;
  color: var(--pb-text);
  font: inherit;
  transition: border-color var(--pb-transition-default), box-shadow var(--pb-transition-default);
}

.login-input:focus {
  border-color: var(--pb-primary);
  box-shadow: inset 0 -1px 0 var(--pb-primary);
}

.login-error {
  margin: -0.5rem 0 0;
  color: var(--ui-error);
  font-size: 0.875rem;
  font-weight: 650;
  line-height: 1.4;
}

.login-submit {
  display: inline-grid;
  min-height: 3rem;
  place-items: center;
  margin-top: 0.25rem;
  border: 0;
  border-radius: 999px;
  background: var(--pb-primary);
  color: var(--pb-primary-contrast);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  transition: background var(--pb-transition-default), opacity var(--pb-transition-default), transform var(--pb-transition-default);
}

.login-submit:hover:not(:disabled),
.login-submit:focus-visible:not(:disabled) {
  background: var(--pb-primary-hover);
  transform: translateY(-1px);
}

.login-submit:focus-visible {
  outline: 0;
  box-shadow: var(--pb-focus-ring);
}

.login-submit:disabled {
  cursor: progress;
  opacity: 0.72;
}

@media (max-width: 480px) {
  .login-panel {
    min-height: auto;
    gap: 2rem;
  }
}
</style>