import { readFile } from 'node:fs/promises'
import { Surreal } from 'surrealdb'
import { describe, expect, it } from 'vitest'
import { startFixture } from '../../scripts/backend-hardening/fixture'
import { authorizedArchiveFiles } from '../../server/utils/media-archive-policy'

// queryDb uses only the supplied owned client; the changed query explicitly
// disables reconnect fallback, so no configured runtime target can be opened.
describe.skipIf(process.env.PB_BACKEND_FIXTURE !== '1')('real archive policy projections', () => {
  it('source and getter SQL carry the visibility policy; missing selections fail closed', async () => {
    const fixture = await startFixture({enabled: process.env.PB_BACKEND_FIXTURE, binary: process.env.PB_BACKEND_SURREAL_BIN ?? ''})
    const db = new Surreal()
    try {
      await db.connect(`${fixture.endpoint.replace('http:', 'ws:')}/rpc`)
      await db.signin({username: fixture.username, password: fixture.password})
      await db.use({namespace: fixture.namespace, database: fixture.database})
      const schema = await readFile('server/utils/schema.surql', 'utf8')
      // Exact application file schema (minus unrelated FTS creation). No app boot.
      const fileSchema = schema.slice(schema.indexOf('DEFINE TABLE OVERWRITE files'), schema.indexOf('-- ============ MEDIA TAGS'))
        .split('\n').filter(line => !line.includes('FULLTEXT')).join('\n')
      await db.query(fileSchema)
      const hashes = ['a'.repeat(64), 'b'.repeat(64)]
      for (const [index, hash] of hashes.entries()) await db.query(`CREATE type::record('files', $hash) CONTENT {
        hash: $hash, original_name: $name, stored_name: $name, original_path: $name,
        mime_type: 'text/plain', extension: 'txt', size: 32, visibility: $visibility
      };`, {hash, name: `${index}.txt`, visibility: index === 0 ? 'private' : 'public'})
      const owner = {id: 'users:admin', username: 'admin'}
      for (const source of [true, false]) {
        const files = await authorizedArchiveFiles(db, hashes, owner, source)
        expect(files).toHaveLength(2)
        expect(files.find(file => file.hash === hashes[0])).toMatchObject({visibility: 'private'})
      }
      await expect(authorizedArchiveFiles(db, ['c'.repeat(64)], owner, true)).rejects.toMatchObject({statusCode: 404})
      process.stdout.write(JSON.stringify({evidence: 'REV-1.5-local-real-SQL-not-production', node: process.version, surreal: (await db.version()).version, sdk: '2.0.3'}) + '\n')
    } finally {try {await db.close()} finally {await fixture.stop()}}
  }, 60_000)
})
