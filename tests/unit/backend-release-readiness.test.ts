import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fixtureEnvironment } from '../../scripts/backend-hardening/fixture'
import { describe, expect, it } from 'vitest'
import { evaluateRelease, GATES, parseEvidence, parseTaskStatuses, readEvidenceFile } from '../../scripts/backend-hardening/release-readiness'

const revision = 'a'.repeat(40)
const context = { revision, compatibleRevisions: [revision], dirty: false }
const tasks = Object.fromEntries([
  'REV-0.0', 'REV-0.1', ...Array.from({ length: 6 }, (_, n) => `REV-1.${n + 1}`),
  ...Array.from({ length: 4 }, (_, n) => `REV-2.${n + 1}`),
  ...Array.from({ length: 3 }, (_, n) => `REV-3.${n + 1}`),
  ...Array.from({ length: 7 }, (_, n) => `REV-4.${n + 1}`), 'REV-5.1', 'REV-5.2'
].map(id => [id, 'done']))
function record(id: string) {
  return {
    id, status: 'passed', revision, observedAt: '2026-10-06T00:00:00.000Z',
    tier: GATES.find(gate => gate.id === id)!.tier, command: 'owned fixture command',
    summary: 'Explicit cases and results recorded in artifact; no configured data used.',
    runtime: { node: 'v22.22.0', surreal: '3.2.4+20260803.93ab219', sdk: '2.0.3', nuxt: '4.4.8', sharp: '0.34.5', os: 'linux' },
    profile: '2 vCPU; app 1 GiB; DB 2 GiB; disk 8 GiB; predeclared workload and latency targets',
    operator: 'fixture operator', artifacts: [{ path: 'docs/backend-hardening/evidence/sample.json', sha256: 'b'.repeat(64) }]
  }
}
const manifest = () => ({ version: 1, records: GATES.map(gate => record(gate.id)) })

// This is hardening-project tooling acceptance, NOT evidence for its gates.
describe('hardening project acceptance fails closed', () => {
  it('does not equate partial Phase 4 or missing evidence with a release pass', () => {
    const result = evaluateRelease(tasks, parseEvidence({ version: 1, records: [] }), context, 'local')
    expect(result.ready).toBe(false)
    expect(result.gates.every(gate => gate.status === 'pending')).toBe(true)
    const changed = { ...tasks, 'REV-4.2': 'blocked', 'REV-4.3': 'in-progress' }
    expect(evaluateRelease(changed, parseEvidence(manifest()), context, 'local').blockers).toContain('REV-4.2: blocked')
    expect(evaluateRelease(changed, parseEvidence(manifest()), context, 'local').blockers).toContain('REV-4.3: in-progress')
    const missing = { ...tasks }
    delete missing['REV-3.3']
    expect(evaluateRelease(missing, parseEvidence(manifest()), context, 'local').blockers).toContain('REV-3.3: missing')
  })

  it('requires complete local evidence and distinguishes pre/post deployment', () => {
    const local = manifest()
    local.records = local.records.filter(row => GATES.find(gate => gate.id === row.id)!.stage === 'local')
    expect(evaluateRelease(tasks, parseEvidence(local), context, 'local').ready).toBe(true)
    expect(evaluateRelease(tasks, parseEvidence(local), context, 'predeploy').ready).toBe(false)
    expect(evaluateRelease(tasks, parseEvidence(manifest()), context, 'postdeploy').ready).toBe(true)
    expect(evaluateRelease({ ...tasks, 'REV-5.2': 'todo' }, parseEvidence(manifest()), context, 'predeploy').ready).toBe(false)
    expect(evaluateRelease(tasks, parseEvidence(manifest()), { ...context, dirty: true }, 'local').ready).toBe(false)
  })

  it('rejects stale, wrong-runtime, mocked and non-Linux acceptance', () => {
    for (const mutate of [
      (row: ReturnType<typeof record>) => { row.revision = 'c'.repeat(40) },
      (row: ReturnType<typeof record>) => { row.runtime.node = 'v24.15.0' },
      (row: ReturnType<typeof record>) => { row.runtime.surreal = '3.3.0' },
      (row: ReturnType<typeof record>) => { row.runtime.surreal = '3.2.4-beta.1' },
      (row: ReturnType<typeof record>) => { row.runtime.sdk = '^2.0.3' },
      (row: ReturnType<typeof record>) => { row.observedAt = '2099-01-01T00:00:00.000Z' },
      (row: ReturnType<typeof record>) => { row.runtime.os = 'win32' },
      (row: ReturnType<typeof record>) => { row.tier = 'unit' as typeof row.tier }
    ]) {
      const value = manifest()
      mutate(value.records.find(row => row.id === 'linux-filesystem')!)
      expect(evaluateRelease(tasks, parseEvidence(value), context, 'local').ready).toBe(false)
    }
    const old = 'c'.repeat(40)
    const value = manifest()
    value.records[0]!.revision = old
    expect(evaluateRelease(tasks, parseEvidence(value), { ...context, compatibleRevisions: [revision, old] }, 'local').ready).toBe(true)
  })

  it('requires actual resource profile and operator evidence, not just a passed label', () => {
    for (const id of ['mixed-load', 'copy-rehearsal', 'cutover-authorization', 'overnight']) {
      const value: { version: number, records: Record<string, unknown>[] } = manifest()
      const row = value.records.find(row => row.id === id)!
      Reflect.deleteProperty(row, id === 'mixed-load' ? 'profile' : 'operator')
      expect(evaluateRelease(tasks, parseEvidence(value), context, 'postdeploy').ready).toBe(false)
    }
    for (const field of ['revision', 'observedAt', 'command', 'summary', 'runtime', 'artifacts']) {
      const value: { version: number, records: Record<string, unknown>[] } = manifest()
      Reflect.deleteProperty(value.records[0]!, field)
      expect(() => parseEvidence(value)).toThrow()
    }
  })

  it('never accepts risk in lieu of mandatory local work or deployment authorization', () => {
    const value: { version: number, records: Record<string, unknown>[] } = manifest()
    const risk = { status: 'accepted-risk', operator: 'owner', rationale: 'Approved limited cache exposure', mitigation: 'Purge within change window', expiresAt: '2099-01-01T00:00:00.000Z' }
    Object.assign(value.records.find(row => row.id === 'proxy-cache-purge')!, risk)
    expect(evaluateRelease(tasks, parseEvidence(value), context, 'predeploy').ready).toBe(true)
    Object.assign(value.records.find(row => row.id === 'node22-checks')!, risk)
    expect(evaluateRelease(tasks, parseEvidence(value), context, 'local').ready).toBe(false)
    Object.assign(value.records.find(row => row.id === 'cutover-authorization')!, risk)
    expect(evaluateRelease(tasks, parseEvidence(value), context, 'predeploy').ready).toBe(false)
    value.records.find(row => row.id === 'proxy-cache-purge')!.expiresAt = '2000-01-01T00:00:00.000Z'
    expect(evaluateRelease(tasks, parseEvidence(value), context, 'predeploy').ready).toBe(false)
  })

  it('rejects duplicate/unknown records, unsafe paths, excessive manifests and invalid ledgers', () => {
    const row = record('node22-checks')
    for (const records of [[row, row], [{ ...row, id: 'invented' }]]) expect(() => parseEvidence({ version: 1, records })).toThrow()
    for (const path of ['.env', 'storage/dump.txt', '../evidence/test.txt', 'docs/backend-hardening/evidence/../operations.md', 'https://example.com/log.txt']) {
      expect(() => parseEvidence({ version: 1, records: [{ ...row, artifacts: [{ path, sha256: 'b'.repeat(64) }] }] })).toThrow()
    }
    expect(() => parseEvidence({ version: 1, records: Array(1000).fill(row) })).toThrow()
    expect(parseTaskStatuses('| REV-4.2 | title | blocked | date | note |')).toEqual({ 'REV-4.2': 'blocked' })
    expect(() => parseTaskStatuses('| REV-4.2 | title | complete |')).toThrow()
    expect(() => parseTaskStatuses('| REV-4.2 | title | done |\n| REV-4.2 | title | todo |')).toThrow()
  })

  it('keeps gate IDs, manifest, commands and documentation aligned', async () => {
    const root = fileURLToPath(new URL('../../', import.meta.url))
    const handoff = await readFile(join(root, 'docs/backend-hardening/release-handoff.md'), 'utf8')
    for (const gate of GATES) expect(handoff).toContain(`\`${gate.id}\``)
    // Future evidence may be populated deliberately; it must always remain valid.
    const value = JSON.parse(await readFile(join(root, 'docs/backend-hardening/release-evidence.json'), 'utf8'))
    expect(() => parseEvidence(value)).not.toThrow()
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    expect(pkg.scripts['hardening:acceptance:report']).toContain('--report --stage=postdeploy')
    expect(pkg.scripts['hardening:acceptance:check:local']).toContain('--check --stage=local')
    expect(pkg.scripts['hardening:acceptance:check']).toContain('--check --stage=predeploy')
    expect(pkg.scripts['hardening:acceptance:check:postdeploy']).toContain('--check --stage=postdeploy')
    expect(Object.keys(pkg.scripts).some(key => key.startsWith('release:'))).toBe(false)
  })

  it('reads bounded regular evidence files and checks digests without following links or reading configured data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pb-release-test-'))
    const directory = join(root, 'docs/backend-hardening/evidence')
    await mkdir(directory, { recursive: true })
    const body = 'sanitized synthetic evidence\n'
    const path = 'docs/backend-hardening/evidence/sample.txt'
    const sha256 = createHash('sha256').update(body).digest('hex')
    try {
      await writeFile(join(root, path), body)
      expect(await readEvidenceFile(root, path, sha256)).toBe(body)
      await expect(readEvidenceFile(root, path, 'c'.repeat(64))).rejects.toThrow(/digest/)
      await writeFile(join(root, path), Buffer.alloc(512 * 1024 + 1))
      await expect(readEvidenceFile(root, path)).rejects.toThrow(/budget/)
      await expect(readEvidenceFile(root, '.env')).rejects.toThrow(/path/)
      await expect(readEvidenceFile(root, 'docs/backend-hardening/evidence/missing.txt')).rejects.toThrow()
      await symlink(directory, join(directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
      await expect(readEvidenceFile(root, 'docs/backend-hardening/evidence/linked/sample.txt')).rejects.toThrow(/symlink/)
    } finally { await rm(root, { recursive: true }) }
  })

  // Each invocation boots tsx; four of them can exceed 30s when the full suite runs in parallel.
  const SPAWN_TIMEOUT_MS = 60_000
  const TEST_TIMEOUT_MS = 180_000

  it('reports real ledger blockers and refuses unknown CLI inputs without running commands or using app env', async () => {
    const root = fileURLToPath(new URL('../../', import.meta.url))
    const env = { ...fixtureEnvironment(), SURREAL_URL: 'http://example.invalid', NUXT_SESSION_PASSWORD: 'never-read-this-value' }
    const invoke = (...args: string[]) => spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/backend-hardening/release.ts', ...args], { cwd: root, env, encoding: 'utf8', timeout: SPAWN_TIMEOUT_MS })
    const before = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })
    const report = invoke('--report', '--stage=postdeploy')
    expect(report.status).toBe(0)
    const value = JSON.parse(report.stdout)
    expect(value.productionApproval).toBe(false)
    expect(value.gates).toHaveLength(GATES.length)
    const ledger = parseTaskStatuses(await readFile(join(root, 'docs/backend-hardening/progress.md'), 'utf8'))
    for (const [id, status] of Object.entries(ledger)) {
      if (!id.startsWith('REV-5.') && status !== 'done') expect(value.blockers).toContain(`${id}: ${status}`)
    }
    const check = invoke('--check', '--stage=local')
    expect(check.status).toBe(JSON.parse(check.stdout).ready ? 0 : 1)
    expect(invoke('--report', '--stage=postdeploy', '--endpoint=http://example.invalid').status).not.toBe(0)
    expect(invoke().status).not.toBe(0)
    expect(report.stdout + report.stderr).not.toContain('never-read-this-value')
    expect(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' })).toBe(before)
  }, TEST_TIMEOUT_MS)
})
