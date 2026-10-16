import { parseEnv, promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createOwnedStorage, fixtureEnvironment } from '../../scripts/backend-hardening/fixture'
import { describe, expect, it } from 'vitest'
import { footerPoweredBy, parseEnvironmentBoolean, resolveEnvironment } from '../../utils/runtimeEnvironment'

describe('canonical environment contract', () => {
  it('loads canonical values with the actual Nuxt dotenv/config loader and ignores removed aliases', async () => {
    const storage = await createOwnedStorage()
    try {
      const kit = pathToFileURL(resolve('node_modules/@nuxt/kit/dist/index.mjs')).href
      await writeFile(storage.path('config-test.mjs'), `import {loadNuxtConfig} from ${JSON.stringify(kit)}; import assert from 'node:assert/strict';
const config = await loadNuxtConfig({cwd: process.cwd(), configFile: process.argv[2], globalRc: false});
assert.equal(config.runtimeConfig.surrealAppPassword, process.argv[3]);
assert.equal(config.runtimeConfig.public.footerShowPoweredBy, process.argv[4] === 'true');
assert.equal('appSponsor' in config.runtimeConfig.public, false);
assert.equal(Object.keys(config.runtimeConfig.public).some(key => /password|surreal|secret/i.test(key)), false);
if (process.argv[3] === '') {
  for (const [key, value] of Object.entries({surrealUrl:'ws://127.0.0.1:8000/rpc', surrealNamespace:'main', surrealDatabase:'main', surrealRoot:'root', surrealRootPassword:'', surrealAppUser:'', appOrigin:'', mfaSecret:''})) assert.equal(config.runtimeConfig[key], value);
}`)
      for (const scenario of [
        {file: 'NUXT_SURREAL_APP_PASSWORD=canonical-file\nNUXT_PUBLIC_FOOTER_SHOW_POWERED_BY=on', env: {}, expected: 'canonical-file', footer: 'true'},
        {file: 'SURREAL_URL=ws://removed.invalid/rpc\nSURREAL_NAMESPACE=removed\nSURREAL_DATABASE=removed\nSURREAL_ROOT=removed\nSURREAL_ROOT_PASSWORD=removed\nSURREAL_APP_USER=removed\nSURREAL_APP_PASSWORD=legacy-file\nAPP_ORIGIN=https://removed.invalid\nMFA_SECRET=removed\nGEOIP_DB_PATH=removed\nAPP_SPONSOR=yes\nNUXT_PUBLIC_APP_SPONSOR=yes', env: {SURREAL_APP_PASSWORD: 'legacy-process', NUXT_PUBLIC_APP_SPONSOR: 'true'}, expected: '', footer: 'false'},
        {file: 'NUXT_SURREAL_APP_PASSWORD=canonical-file\nSURREAL_APP_PASSWORD=legacy-file\nAPP_SPONSOR=yes', env: {NUXT_SURREAL_APP_PASSWORD: 'canonical-process', NUXT_PUBLIC_FOOTER_SHOW_POWERED_BY: 'false'}, expected: 'canonical-process', footer: 'false'},
        {file: 'SURREAL_APP_PASSWORD=legacy-file', env: {SURREAL_APP_PASSWORD: 'legacy-process', NUXT_SURREAL_APP_PASSWORD: ''}, expected: '', footer: 'false'}
      ]) {
        await writeFile(storage.path('.env'), `NUXT_SESSION_PASSWORD="synthetic-key-at-least-32-characters"\n${scenario.file}\n`)
        await promisify(execFile)(process.execPath, [storage.path('config-test.mjs'), resolve('nuxt.config.ts'), scenario.expected, scenario.footer], {
          cwd: storage.root, env: {...fixtureEnvironment(), NODE_ENV: 'development', ...scenario.env}, timeout: 20_000, maxBuffer: 4096
        })
      }
    } finally {await storage.cleanup()}
  }, 90_000)
  it('resolves only canonical process, canonical file, then default, preserving empty values', () => {
    const resolve = (local = {}, processEnv = {}) => resolveEnvironment('NUXT_SURREAL_APP_PASSWORD', local, processEnv, 'default')
    expect(resolve({NUXT_SURREAL_APP_PASSWORD: 'file', SURREAL_APP_PASSWORD: 'legacy'}, {NUXT_SURREAL_APP_PASSWORD: 'process'})).toBe('process')
    expect(resolve({NUXT_SURREAL_APP_PASSWORD: 'file'}, {SURREAL_APP_PASSWORD: 'legacy'})).toBe('file')
    expect(resolve({SURREAL_APP_PASSWORD: 'file'}, {SURREAL_APP_PASSWORD: 'process'})).toBe('default')
    expect(resolve({}, {SURREAL_APP_PASSWORD: 'process'})).toBe('default')
    expect(resolve()).toBe('default')
    expect(resolve({SURREAL_APP_PASSWORD: 'old-secret'}, {NUXT_SURREAL_APP_PASSWORD: ''})).toBe('')
    expect(resolve({NUXT_SURREAL_APP_PASSWORD: ''})).toBe('')
  })
  it('uses Node dotenv parsing for quotes, comments, multiline values and CRLF', () => {
    const env = parseEnv("# fixture\r\nNUXT_SURREAL_APP_PASSWORD='literal # password' # comment\r\nexport NUXT_APP_ORIGIN=\"http://localhost:3000\"\r\nNUXT_MFA_SECRET=\"first\nsecond\"\n")
    expect(env.NUXT_SURREAL_APP_PASSWORD).toBe('literal # password')
    expect(env.NUXT_APP_ORIGIN).toBe('http://localhost:3000')
    expect(env.NUXT_MFA_SECRET).toBe('first\nsecond')
  })
  it.each(['true', '1', 'yes', 'on', ' TRUE ', true, 1])('normalizes enabled spelling %s', value => {expect(parseEnvironmentBoolean(value)).toBe(true)})
  it.each(['false', '0', 'no', 'off', ' FALSE ', false, 0, undefined])('normalizes disabled spelling %s', value => {expect(parseEnvironmentBoolean(value)).toBe(false)})
  it.each(['', 'typo-secret', 'enabled', null, 2, {}])('rejects unsupported booleans without echoing supplied values', value => {
    expect(() => parseEnvironmentBoolean(value)).toThrow('must be a supported boolean')
    expect(() => parseEnvironmentBoolean(value)).not.toThrow('typo-secret')
  })
  it('ignores both removed sponsor names at runtime; canonical empty still rejects', () => {
    expect(footerPoweredBy(true, {NUXT_PUBLIC_FOOTER_SHOW_POWERED_BY: 'false', NUXT_PUBLIC_APP_SPONSOR: 'true'})).toBe(false)
    expect(() => footerPoweredBy(false, {NUXT_PUBLIC_FOOTER_SHOW_POWERED_BY: '', NUXT_PUBLIC_APP_SPONSOR: 'true'})).toThrow()
    expect(footerPoweredBy(false, {NUXT_PUBLIC_APP_SPONSOR: 'on', APP_SPONSOR: 'true'})).toBe(false)
    expect(footerPoweredBy(true, {NUXT_PUBLIC_APP_SPONSOR: 'off'})).toBe(true)
    expect(resolveEnvironment('NUXT_PUBLIC_FOOTER_SHOW_POWERED_BY', {APP_SPONSOR: 'true'}, {NUXT_PUBLIC_APP_SPONSOR: 'true'}, 'false')).toBe('false')
  })
  it('ships canonical-only development and production examples with visible required credentials', async () => {
    for (const path of ['.env.example', 'deploy/production/.env.example']) {
      const example = parseEnv(await readFile(resolve(path), 'utf8'))
      for (const key of ['NUXT_SURREAL_URL', 'NUXT_SURREAL_NAMESPACE', 'NUXT_SURREAL_DATABASE', 'NUXT_SURREAL_ROOT', 'NUXT_SURREAL_ROOT_PASSWORD', 'NUXT_SURREAL_APP_USER', 'NUXT_SURREAL_APP_PASSWORD', 'NUXT_APP_ORIGIN', 'NUXT_SESSION_PASSWORD', 'NUXT_PUBLIC_FOOTER_SHOW_POWERED_BY']) expect(example).toHaveProperty(key)
      expect(Object.keys(example).filter(key => !key.startsWith('NUXT_'))).toEqual(expect.arrayContaining(['LOG_CONSOLE', 'LOG_FORMAT']))
      expect(Object.keys(example).every(key => key.startsWith('NUXT_') || ['LOG_CONSOLE', 'LOG_FORMAT', 'NODE_OPTIONS', 'E2E_ADMIN_USERNAME', 'E2E_ADMIN_PASSWORD'].includes(key))).toBe(true)
      expect(parseEnvironmentBoolean(example.NUXT_PUBLIC_FOOTER_SHOW_POWERED_BY)).toBe(false)
      for (const key of ['NUXT_SURREAL_ROOT_PASSWORD', 'NUXT_SURREAL_APP_PASSWORD', 'NUXT_SESSION_PASSWORD']) expect(example[key]).toBe('')
      if (path === '.env.example') {
        expect(example.NODE_OPTIONS).toBe('--max-old-space-size=4096')
        expect(example.E2E_ADMIN_USERNAME).toBe('')
        expect(example.E2E_ADMIN_PASSWORD).toBe('')
      }
    }
  })
})
