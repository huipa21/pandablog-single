import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { parseEnvironmentBoolean, resolveEnvironment } from './utils/runtimeEnvironment'
import svgLoader from 'vite-svg-loader'

const isProd = process.env.NODE_ENV === 'production'
const localEnv = isProd ? {} : readLocalEnv()

/** Production defaults stay non-secret: distributable builds must not embed
 * operator secrets. Built Nitro reads canonical process-env overrides. */
function env(name: string, fallback = ''): string {
  if (isProd) return fallback
  return resolveEnvironment(name, localEnv, process.env, fallback)
}

const publicThemeInitScript = `(() => {
  try {
    const serverMode = document.documentElement.dataset.theme
    const storedMode = localStorage.getItem('pb-public-color-mode')
    const mode = serverMode === 'light' || serverMode === 'dark'
      ? serverMode
      : storedMode === 'light' || storedMode === 'dark'
      ? storedMode
      : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'

    document.documentElement.dataset.theme = mode
    document.documentElement.style.colorScheme = mode
  } catch {}
})()`

const sessionPassword = env('NUXT_SESSION_PASSWORD')
if (!isProd && (!sessionPassword || sessionPassword.length < 32)) {
  throw new Error(
    'NUXT_SESSION_PASSWORD must be set to a 32+ character random string in .env'
  )
}

export default defineNuxtConfig({
  compatibilityDate: '2026-05-17',
  devtools: { enabled: !isProd },
  modules: [
    '@nuxt/fonts',
    '@nuxt/ui',
    '@nuxt/icon',
    '@pinia/nuxt',
    '@nuxtjs/i18n',
    'nuxt-auth-utils'
  ],
  fonts: {
    families: [
      {
        name: 'Lora',
        provider: 'google',
        weights: [400, 600, 700],
        styles: ['normal'],
        global: true
      }
    ]
  },
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'en',
    langDir: 'locales',
    locales: [
      { code: 'en', name: 'English', language: 'en-US', file: 'en.json' },
      { code: 'zh-CN', name: '简体中文', language: 'zh-CN', file: 'zh-CN.json' }
    ],
    // Disabled: Nuxt i18n would detect Accept-Language on the server and
    // navigator.language on the client, which disagree and cause hydration
    // mismatches. The public language comes from the `pb-public-locale` cookie
    // (plugins/i18n-locale.ts); the admin language from the admin setting.
    detectBrowserLanguage: false
  },
  css: ['~/assets/css/main.css'],
  icon: {
    provider: 'server',
    serverBundle: {
      collections: ['lucide']
    },
    clientBundle: {
      scan: true
    }
  },
  runtimeConfig: {
    // Build identity, injected at build time by modules/build-version.ts.
    // Private on purpose: the exact build is only exposed to authenticated
    // admins via /api/admin/system/version, never in the public bundle.
    appVersion: '',
    // Required in production for exact browser mutation origin checks. Never
    // derive this trust boundary from forwarded request headers.
    appOrigin: env('NUXT_APP_ORIGIN', ''),
    surrealUrl: env('NUXT_SURREAL_URL', 'ws://127.0.0.1:8000/rpc'),
    surrealNamespace: env('NUXT_SURREAL_NAMESPACE', 'main'),
    surrealDatabase: env('NUXT_SURREAL_DATABASE', 'main'),
    surrealRoot: env('NUXT_SURREAL_ROOT', 'root'),
    surrealRootPassword: env('NUXT_SURREAL_ROOT_PASSWORD', ''),
    // Required in every runtime mode. Ordinary work never falls back to ROOT;
    // ROOT remains dedicated to owned provisioning/schema/backup/restore.
    surrealAppUser: env('NUXT_SURREAL_APP_USER', ''),
    surrealAppPassword: env('NUXT_SURREAL_APP_PASSWORD', ''),
    // Optional dedicated key for encrypting stored TOTP/MFA secrets at rest.
    // When unset, the session cookie password is used as the key source.
    // Rotating this value (or the session password fallback) invalidates all
    // stored MFA secrets and requires affected users to re-enroll.
    mfaSecret: env('NUXT_MFA_SECRET', ''),
    session: {
      password: sessionPassword,
      maxAge: 60 * 60 * 24 * 7, // 7 days
      cookie: {
        secure: isProd,
        sameSite: 'lax',
        httpOnly: true
      }
    },
    public: {
      footerShowPoweredBy: parseEnvironmentBoolean(resolveEnvironment(
        'NUXT_PUBLIC_FOOTER_SHOW_POWERED_BY', localEnv, process.env, 'false'
      ))
    }
  },
  nitro: {
    compressPublicAssets: {
      brotli: true,
      gzip: true
    }
  },
  routeRules: {
    '/': { cache: { maxAge: 60, swr: true, staleMaxAge: 120, varies: ['cookie'] } },
    '/_nuxt/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
    '/assets/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } }
  },
  build: {
    transpile: ['@unovis/ts', '@unovis/vue']
  },
  vite: {
    optimizeDeps: {
      include: ['highlight.js/lib/languages/latex', 'katex', 'striptags']
    },
    plugins: [
      svgLoader({
        defaultImport: 'component',
        svgo: false
      })
    ]
  },
  app: {
    head: {
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1' }
      ],
      script: [
        { key: 'pb-public-theme-init', innerHTML: publicThemeInitScript }
      ],
      link: [
        { rel: 'icon', key: 'favicon', type: 'image/x-icon', href: '/favicon.ico' }
      ]
    }
  },
  devServer: {
    port: 3000
  }
})

/**
 * Read .env file from project root.
 * Returns an empty object if the file doesn't exist.
 */
function readLocalEnv(): Record<string, string | undefined> {
  const path = '.env'
  if (!existsSync(path)) return {}

  return parseEnv(readFileSync(path, 'utf8'))
}