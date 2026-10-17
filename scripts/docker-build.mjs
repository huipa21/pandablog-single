#!/usr/bin/env node
/**
 * Build the PandaBlog container image with build identity wired in.
 *
 * Supports both `docker` and `podman` interchangeably:
 *   - Auto-detects `docker` or `podman` if installed (checks `docker` first, then `podman`).
 *   - Can be overridden via `CONTAINER_ENGINE=podman npm run container:build`
 *     or `npm run podman:build`.
 *
 * `.git` is excluded by .dockerignore, so the version must be computed on the
 * host and handed to the build as build-args. This wrapper does that in one step
 * and works identically on Windows, macOS, and Linux.
 *
 * Usage:
 *   npm run container:build
 *   npm run docker:build
 *   npm run podman:build
 *   npm run container:build -- -t myregistry/pandablog-single:custom
 *   APP_VERSION=v1.0.0 npm run container:build
 *
 * APP_VERSION optionally supplies a tag-safe release label; Git metadata and
 * clean-tree checks still apply. Waived dirty builds also mark the label `.dirty`.
 *
 * The Dockerfile always uses node:22-alpine for both build and runtime.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function parseCliArgs(argv) {
  let engine = process.env.CONTAINER_ENGINE?.trim()
  const passthrough = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--engine=')) {
      engine = arg.slice('--engine='.length).trim()
    } else if (arg === '--engine' && i + 1 < argv.length) {
      engine = argv[++i].trim()
    } else {
      passthrough.push(arg)
    }
  }

  return { engine: resolveEngine(engine), passthrough }
}

function resolveEngine(preferred) {
  if (preferred) return preferred

  // Check which executable is available
  for (const candidate of ['docker', 'podman']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' })
      return candidate
    } catch {}
  }
  return 'docker'
}

const { engine, passthrough } = parseCliArgs(process.argv.slice(2))

let info
try {
  const raw = execFileSync(process.execPath, ['scripts/version.mjs', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  info = JSON.parse(raw)
  const label = process.env.APP_VERSION?.trim()
  if (label) info.version = `${label}${info.dirty && !label.endsWith('.dirty') ? '.dirty' : ''}`
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(info.version)) {
    throw new Error('APP_VERSION must be a valid container tag (1–128 letters, digits, underscores, dots or hyphens).')
  }
} catch (error) {
  process.stderr.write(String(error.stderr || error.message))
  process.stderr.write('\n[container:build] aborted — the image must be traceable to a commit.\n')
  process.exit(1)
}

const hasTag = passthrough.some((arg) => arg === '-t' || arg === '--tag')

// The generated datetime/SHA identity (or explicit label) is already tag-safe.
const tag = info.version

const args = [
  'build',
  '--build-arg', `APP_VERSION=${info.version}`,
  '--build-arg', `APP_COMMIT=${info.sha}`,
  '--build-arg', `APP_COMMIT_DATE=${info.committedAt}`,
  ...(hasTag ? [] : ['-t', `pandablog-single:${tag}`, '-t', 'pandablog-single:latest']),
  ...passthrough,
  '.'
]

process.stdout.write(`[container:build] engine: ${engine}\n`)
process.stdout.write(`[container:build] version: ${info.version}\n`)
process.stdout.write(`[container:build] ${engine} ${args.join(' ')}\n\n`)

const result = spawnSync(engine, args, { cwd: ROOT, stdio: 'inherit' })
if (result.error) {
  process.stderr.write(`\n[container:build] failed to run '${engine}': ${result.error.message}\n`)
  process.exit(1)
}
process.exit(result.status ?? 1)
