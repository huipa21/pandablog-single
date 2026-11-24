import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { boundedText, importStatementCount } from '../../scripts/backend-hardening/http'
import { describe, expect, it } from 'vitest'
import {
  assertFixtureTarget, assertOptIn, assertRuntime, assertSurrealVersion,
  createOwnedStorage, fixtureEnvironment, startFixture
} from '../../scripts/backend-hardening/fixture'
import { barrier, manualClock } from '../helpers/backend-hardening'
import { writeSqlFixture } from '../../scripts/backend-hardening/generate'

describe('backend harness fails closed', () => {
  it('keeps the runtime pin synchronized', async () => {
    expect((await readFile(new URL('../../.node-version', import.meta.url), 'utf8')).trim()).toBe('22.22.0')
  })

  it('requires deliberate opt-in, pinned Node and the approved stable DB minor', () => {
    for (const value of [undefined, '', 'true', '0']) expect(() => assertOptIn(value)).toThrow()
    expect(() => assertOptIn('1')).not.toThrow()
    expect(() => assertRuntime('v22.22.0')).not.toThrow()
    for (const value of ['v24.15.0', 'v22.21.0']) expect(() => assertRuntime(value)).toThrow()
    expect(() => assertSurrealVersion('3.2.5 for linux on x86_64')).not.toThrow()
    expect(() => assertSurrealVersion('surrealdb-3.2.5+20260803.abc123')).not.toThrow()
    for (const value of ['3.2.0', '3.2.4+20260803.93ab219 for windows on x86_64', 'surrealdb-3.2.12']) expect(() => assertSurrealVersion(value)).not.toThrow()
    for (const value of ['3.1.6', '3.3.0', '3.2.4-beta.1', '3.2.5-beta.1', '3.2.04', '3.2.x', 'prefix 3.2.5']) expect(() => assertSurrealVersion(value)).toThrow()
  })

  it('rejects remote, ambiguous or non-test targets without consulting application env', () => {
    const ns = 'pb_rev_test_' + 'a'.repeat(32)
    expect(() => assertFixtureTarget('http://127.0.0.1:18083', ns, ns)).not.toThrow()
    for (const url of ['https://example.com', 'http://localhost:18083', 'http://127.0.0.2:18083', 'http://127.0.0.1', 'http://127.0.0.1:18083/rpc', 'http://root:secret@127.0.0.1:18083', 'http://127.0.0.1:18083?x=1', 'http://127.1:18083']) {
      expect(() => assertFixtureTarget(url, ns, ns)).toThrow()
    }
    for (const name of ['', 'test', 'production', 'pb_rev_test_old', ns + ';']) expect(() => assertFixtureTarget('http://127.0.0.1:18083', name, ns)).toThrow()
    const env = fixtureEnvironment({ PATH: '/bin', SystemRoot: 'C:/Windows', DATABASE_URL: 'secret', SURREAL_URL: 'secret', PB_ERROR_GROUPS_LIVE: '1', NODE_OPTIONS: '--require=unsafe', NUXT_SESSION_PASSWORD: 'secret' })
    expect(env).toEqual({ PATH: '/bin', SystemRoot: 'C:/Windows' })
  })

  it('creates fresh owned storage twice, refuses traversal and preserves unrelated files', async () => {
    const neighbor = await mkdtemp(join(tmpdir(), 'pb-neighbor-'))
    await writeFile(join(neighbor, 'keep'), 'unrelated')
    const paths: string[] = []
    try {
      for (let index = 0; index < 2; index++) {
        const owned = await createOwnedStorage()
        paths.push(owned.root)
        try {
          for (const name of ['../storage', '/storage', 'storage/uploads', 'a\\b', '..', '']) expect(() => owned.path(name)).toThrow()
          await writeFile(owned.path('sample'), 'synthetic')
        } finally { await owned.cleanup() }
        await expect(readFile(join(owned.root, 'sample'))).rejects.toThrow()
        await owned.cleanup() // idempotent
      }
      expect(paths[0]).not.toBe(paths[1])
      expect(await readFile(join(neighbor, 'keep'), 'utf8')).toBe('unrelated')
    } finally { await rm(neighbor, { recursive: true }) }
  })

  it('refuses cleanup after a corrupt ownership receipt', async () => {
    const owned = await createOwnedStorage()
    const receipt = await readFile(owned.path('.owner'), 'utf8')
    try {
      await writeFile(owned.path('.owner'), 'not-owned')
      await expect(owned.cleanup()).rejects.toThrow(/ownership/)
    } finally {
      await writeFile(owned.path('.owner'), receipt)
      await owned.cleanup()
    }
  })

  it('bounds HTTP response bytes and disposes overflow streams', async () => {
    let cancelled = false
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(1025)) },
      cancel() { cancelled = true }
    })
    await expect(boundedText(new Response(body), 1024)).rejects.toThrow(/byte budget/)
    expect(cancelled).toBe(true)
    expect(await boundedText(new Response('small'), 1024)).toBe('small')
    for (const limit of [Infinity, -1, 0, 1.5, 1024 * 1024 + 1]) await expect(boundedText(new Response('small'), limit)).rejects.toThrow(/budget/)
  })

  it('validates import acknowledgements without treating suppressed results as imported rows', () => {
    expect(importStatementCount('[]')).toBe(0)
    expect(importStatementCount('[{"status":"OK"}]')).toBe(1)
    for (const body of ['not JSON', 'null', '{}', '[{"status":"ERR"}]', '[{}]', '[null]', '[{"status":true}]', ' '.repeat(65537)]) expect(() => importStatementCount(body)).toThrow()
  })

  it('refuses starting a fixture without opt-in before any process or storage work', async () => {
    await expect(startFixture({ enabled: undefined, binary: process.execPath })).rejects.toThrow(/opt-in/)
  })

  it('streams SQL with byte limits, reports seed failure separately and refuses overwrite', async () => {
    const owned = await createOwnedStorage()
    try {
      const result = await writeSqlFixture(owned, 'seed.surql', { rows: 205, payloadBytes: 100, chunkBytes: 1024, maxBytes: 100_000 })
      expect(result.rows).toBe(205)
      expect(result.maxChunkBytes).toBeLessThanOrEqual(1024)
      const sql = await readFile(owned.path('seed.surql'), 'utf8')
      expect(sql.startsWith('OPTION IMPORT;\n')).toBe(true)
      expect(Buffer.byteLength(sql)).toBe(result.bytes)
      expect(sql.match(/CREATE fixture_seed:/g)).toHaveLength(205)
      await expect(writeSqlFixture(owned, 'seed.surql', { rows: 1 })).rejects.toThrow(/seed/)
      expect(await readFile(owned.path('seed.surql'), 'utf8')).toBe(sql)
      await expect(writeSqlFixture(owned, 'too-large', { rows: 100, maxBytes: 100 })).rejects.toThrow(/seed/)
      await expect(readFile(owned.path('too-large'))).rejects.toThrow()
      const abort = new AbortController()
      abort.abort()
      await expect(writeSqlFixture(owned, 'aborted', { rows: 100, signal: abort.signal })).rejects.toThrow(/seed/)
      await expect(readFile(owned.path('aborted'))).rejects.toThrow()
      const empty = await writeSqlFixture(owned, 'empty.surql', { rows: 0, chunkBytes: 1 })
      expect(empty).toEqual({ rows: 0, bytes: 15, maxChunkBytes: 1 })
      expect(await readFile(owned.path('empty.surql'), 'utf8')).toBe('OPTION IMPORT;\n')
      await expect(writeSqlFixture(owned, '.owner', { rows: 1 })).rejects.toThrow(/ownership/)
      for (const options of [{ rows: Infinity }, { rows: -1 }, { rows: 1, payloadBytes: 1_000_000 }, { rows: 1, chunkBytes: 0 }]) {
        await expect(writeSqlFixture(owned, 'invalid', options)).rejects.toThrow()
      }
    } finally { await owned.cleanup() }
  })
})

describe('deterministic backend test helpers', () => {
  it('controls clock advancement and simultaneous arrivals without sleeps', async () => {
    const clock = manualClock(1000)
    clock.advance(50)
    expect(clock.now()).toBe(1050)
    const gate = barrier(3)
    const arrivals: number[] = []
    await Promise.all([1, 2, 3].map(async n => { await gate.wait(); arrivals.push(n) }))
    expect(arrivals).toHaveLength(3)
    expect(() => barrier(0)).toThrow()
    expect(() => clock.advance(-1)).toThrow()
  })
})
