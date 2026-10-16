import { execFileSync, spawnSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixtureEnvironment } from '../../scripts/backend-hardening/fixture'

const generator = fileURLToPath(new URL('../../scripts/version.mjs', import.meta.url))
const env = fixtureEnvironment()
const roots: string[] = []
const auth = vi.hoisted(() => ({ requireOwner: vi.fn() }))
vi.mock('../../server/utils/auth', () => auth)

function git(cwd: string, ...args: string[]) {
  return execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 }).trim()
}
async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'pb-version-owned-'))
  roots.push(root)
  git(root, 'init', '--initial-branch=main')
  git(root, 'config', 'user.name', 'Version Fixture')
  git(root, 'config', 'user.email', 'version@example.invalid')
  git(root, 'config', 'commit.gpgsign', 'false')
  await writeFile(join(root, 'source.txt'), 'owned synthetic source\n')
  git(root, 'add', 'source.txt')
  commit(root)
  return root
}
function commit(root: string) {
  execFileSync('git', ['commit', '--allow-empty', '-m', 'owned fixture'], {
    cwd: root, stdio: 'ignore', timeout: 10_000, env: {
      ...env, GIT_AUTHOR_DATE: '2026-10-10T13:31:30+08:00', GIT_COMMITTER_DATE: '2026-10-10T13:31:30+08:00'
    }
  })
}
function invoke(root: string, args: string[] = [], overrides: Record<string, string> = {}) {
  return spawnSync(process.execPath, [generator, ...args], {
    cwd: root, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 10_000
  })
}
function info(root: string, args: string[] = [], overrides: Record<string, string> = {}) {
  const result = invoke(root, ['--json', ...args], overrides)
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout)
}

beforeEach(() => { vi.resetAllMocks() })
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

// Each case launches multiple bounded Git/Node processes on Windows.
describe('commit datetime + SHA build identity', { timeout: 30_000 }, () => {
  it('normalizes the committer timestamp to UTC and retains full metadata without a sequence', async () => {
    const root = await repository()
    const sha = git(root, 'rev-parse', 'HEAD')
    const value = info(root, [], { TZ: 'Pacific/Honolulu' })
    expect(value).toEqual({
      version: `20261010T053130Z-g${sha.slice(0, 12)}`, date: '20261010',
      sha, shortSha: sha.slice(0, 12), committedAt: '2026-10-10T05:31:30Z', dirty: false
    })
    expect(info(root, [], { TZ: 'Asia/Shanghai' })).toEqual(value)
    expect(invoke(root).stdout.trim()).toBe(value.version)
    expect(value.version).toMatch(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/)
  })

  it('keeps old identities unchanged after later same-timestamp commits and annotated tags', async () => {
    const root = await repository()
    const original = info(root)
    commit(root)
    expect(info(root).version).not.toBe(original.version)
    expect(info(root, ['--commit', original.sha])).toEqual(original)
    git(root, 'tag', '-a', 'v1.0.0', '-m', 'owned tag', original.sha)
    expect(info(root, ['--commit', 'v1.0.0'])).toEqual(original)
  })

  it('produces identical metadata from a depth-one clone', async () => {
    const root = await repository()
    commit(root)
    const expected = info(root)
    const clone = await mkdtemp(join(tmpdir(), 'pb-version-shallow-owned-'))
    roots.push(clone)
    git(root, 'clone', '--depth=1', '--no-local', pathToFileURL(root).href, clone)
    expect(git(clone, 'rev-parse', '--is-shallow-repository')).toBe('true')
    expect(info(clone)).toEqual(expected)
  })

  it.each(['tracked', 'untracked'])('refuses %s changes or explicitly marks them dirty', async kind => {
    const root = await repository()
    const clean = info(root)
    await writeFile(join(root, kind === 'tracked' ? 'source.txt' : 'extra.txt'), 'owned change\n')
    const result = invoke(root)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('working tree has uncommitted changes')
    expect(info(root, [], { PANDA_ALLOW_DIRTY: '1' })).toEqual({ ...clean, dirty: true, version: `${clean.version}.dirty` })
  })

  it('wires identity into the container wrapper without launching a container engine', async () => {
    const root = await repository()
    await mkdir(join(root, 'scripts'))
    await copyFile(generator, join(root, 'scripts/version.mjs'))
    await copyFile(fileURLToPath(new URL('../../scripts/docker-build.mjs', import.meta.url)), join(root, 'scripts/docker-build.mjs'))
    // Node acts as a synthetic engine: its "build" script only prints arguments.
    await writeFile(join(root, 'build'), 'console.log(JSON.stringify(process.argv.slice(2)))\n')
    git(root, 'add', 'scripts', 'build')
    commit(root)
    const expected = info(root)
    const build = (overrides: Record<string, string> = {}) => spawnSync(process.execPath, [
      join(root, 'scripts/docker-build.mjs'), `--engine=${process.execPath}`
    ], { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 15_000 })
    function argumentsFrom(result: ReturnType<typeof build>) {
      expect(result.status, result.stderr).toBe(0)
      return JSON.parse(result.stdout.trim().split('\n').at(-1)!) as string[]
    }
    const generated = argumentsFrom(build())
    expect(generated).toContain(`APP_VERSION=${expected.version}`)
    expect(generated).toContain(`APP_COMMIT=${expected.sha}`)
    expect(generated).toContain(`APP_COMMIT_DATE=${expected.committedAt}`)
    expect(generated).toContain(`pandablog:${expected.version}`)
    const labeled = argumentsFrom(build({ APP_VERSION: 'v1.0.0' }))
    expect(labeled).toContain('APP_VERSION=v1.0.0')
    expect(labeled).toContain(`APP_COMMIT=${expected.sha}`)
    expect(build({ APP_VERSION: 'invalid+tag' }).status).toBe(1)
    await writeFile(join(root, 'source.txt'), 'owned change\n')
    expect(build({ APP_VERSION: 'v1.0.0' }).status).toBe(1)
    expect(argumentsFrom(build({ APP_VERSION: 'v1.0.0', PANDA_ALLOW_DIRTY: '1' }))).toContain('APP_VERSION=v1.0.0.dirty')
  })

  it('fails for missing repositories, unknown revisions, non-commits and malformed CLI arguments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pb-version-no-git-owned-'))
    roots.push(root)
    expect(invoke(root).status).toBe(1)
    const repo = await repository()
    const blob = git(repo, 'rev-parse', 'HEAD:source.txt')
    for (const args of [['--commit'], ['--commit', '--json'], ['--unknown'], ['--commit', 'missing'], ['--commit', blob]]) {
      expect(invoke(repo, args).status).toBe(1)
    }
  })
})

describe('admin-only build version endpoint', () => {
  const event = {} as H3Event
  async function handler(version: string) {
    vi.stubGlobal('defineEventHandler', (fn: unknown) => fn)
    vi.stubGlobal('useRuntimeConfig', () => ({ appVersion: version }))
    return (await import('../../server/api/admin/system/version.get')).default
  }

  it.each([
    ['20261010T053130Z-g4c426999aa95', '20261010', '4c426999aa95', null, false],
    ['20261010T053130Z-g4c426999aa95.dirty', '20261010', '4c426999aa95', null, true],
    ['260923-1+gedb176f', '260923', 'edb176f', 1, false],
    ['v1.0.0', null, null, null, false]
  ])('displays %s without inventing metadata', async (version, date, sha, sequence, dirty) => {
    const result = await (await handler(version as string))(event)
    expect(auth.requireOwner).toHaveBeenCalledExactlyOnceWith(event)
    expect(result).toEqual({ version, date, commit: sha, sequence, dirty, node: process.version })
  })

  it('refuses unauthorized access before reading runtime configuration', async () => {
    const route = await handler('20261010T053130Z-g4c426999aa95')
    const runtime = vi.fn()
    vi.stubGlobal('useRuntimeConfig', runtime)
    auth.requireOwner.mockRejectedValue(new Error('Unauthorized'))
    await expect(route(event)).rejects.toThrow('Unauthorized')
    expect(runtime).not.toHaveBeenCalled()
  })
})
