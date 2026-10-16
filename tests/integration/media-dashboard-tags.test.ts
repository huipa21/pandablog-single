import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createApp, createError, defineEventHandler, getQuery, toNodeListener } from 'h3'
import { Surreal } from 'surrealdb'
import { describe, expect, it, vi } from 'vitest'
import { startFixture } from '../../scripts/backend-hardening/fixture'

const state = vi.hoisted(() => ({db: null as Surreal | null}))
const owner = {id: 'users:admin', username: 'admin'}
vi.mock('../../server/utils/auth', () => ({requireOwner: async () => owner}))
vi.mock('../../server/utils/settings', () => ({getMediaSettings: async () => ({oversized_image_threshold_mb: 2, max_file_size_mb: 20})}))
vi.mock('../../server/utils/db', async original => ({
  ...await original<typeof import('../../server/utils/db')>(),
  useDb: async () => state.db!
}))

// Real endpoint handlers and SQL; credentials/storage belong only to the owned fixture.
describe.skipIf(process.env.PB_BACKEND_FIXTURE !== '1')('media tags and dashboard routes on actual SDK/3.2.x', () => {
  it('handles untagged libraries, shows older assets by default and includes the owner\'s private files', async () => {
    const fixture = await startFixture({enabled: process.env.PB_BACKEND_FIXTURE, binary: process.env.PB_BACKEND_SURREAL_BIN ?? ''})
    const db = new Surreal()
    let server: ReturnType<typeof createServer> | undefined
    try {
      await db.connect(`${fixture.endpoint.replace('http:', 'ws:')}/rpc`)
      await db.signin({username: fixture.username, password: fixture.password})
      await db.use({namespace: fixture.namespace, database: fixture.database})
      state.db = db
      const schema = await readFile('server/utils/schema.surql', 'utf8')
      const analyzer = schema.split('\n').find(line => line.startsWith('DEFINE ANALYZER') && line.includes('blog_analyzer'))!
      await db.query(analyzer + '\n' + schema.slice(schema.indexOf('DEFINE TABLE OVERWRITE folder'), schema.indexOf('-- ============ MEDIA TAGS')))
      for (const [key, value] of Object.entries({defineEventHandler, createError, getQuery})) vi.stubGlobal(key, value)
      const app = createApp()
      app.use('/tags', (await import('../../server/api/media/tags.get')).default)
      app.use('/dashboard', (await import('../../server/api/admin/dashboard/media.get')).default)
      server = createServer(toNodeListener(app))
      await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
      const base = `http://127.0.0.1:${(server.address() as {port: number}).port}`
      const get = async (path: string) => {
        const response = await fetch(base + path)
        expect(response.status).toBe(200)
        return response.json()
      }
      expect(await get('/tags')).toEqual({tags: [], truncated: false})
      const createFile = async (id: string, tags: string[], visibility = 'public', storageState = 'ready') => {
        await db.query(`CREATE type::record('files', $id) CONTENT {
          hash: $id, original_name: 'fixture.jpg', stored_name: 'fixture.jpg', original_path: 'fixture.jpg',
          mime_type: 'image/jpeg', extension: 'jpg', size: 100, is_image: true,
          tags: $tags, visibility: $visibility, storage_state: $storageState, uploaded_at: $date
        };`, {id, tags, visibility, storageState, date: new Date('2024-01-01T00:00:00Z')})
      }
      await createFile('untagged', [])
      expect(await get('/tags')).toEqual({tags: [], truncated: false})
      await createFile('tagged', ['Nature', 'travel'])
      await createFile('owned', ['nature'], 'private')
      await createFile('secret', ['secret'], 'private')
      await createFile('publishing', ['unfinished'], 'public', 'publishing')
      const tags = await get('/tags')
      expect(tags.truncated).toBe(false)
      expect(tags.tags.map((tag: {id: string, count: number}) => ({id: tag.id, count: tag.count}))).toEqual([{id: 'nature', count: 2}, {id: 'secret', count: 1}, {id: 'travel', count: 1}])
      expect((await get('/tags?q=NATURE')).tags).toHaveLength(1)
      expect((await get('/tags?q=unfinished')).tags).toEqual([])
      const all = await get('/dashboard')
      expect(all.summary).toEqual({total_items: 4, total_storage: 400, average_size: 100})
      expect(all.time_insights).toMatchObject({range: 'all', start: null, uploaded_items: 4})
      expect(all.by_type.find((row: {type: string}) => row.type === 'image')).toMatchObject({count: 4, storage: 400})
      expect(all.largest_files).toHaveLength(4)
      const recent = await get('/dashboard?range=custom&from=2026-10-03&to=2026-10-09')
      expect(recent.summary).toEqual({total_items: 0, total_storage: 0, average_size: 0})
      expect(recent.largest_files).toEqual([])
      expect(recent.time_insights).toMatchObject({range: 'custom', uploaded_items: 0})
      expect((await get('/dashboard?range=all')).summary).toEqual(all.summary)
    } finally {
      if (server) {server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve()))}
      vi.unstubAllGlobals()
      state.db = null
      await db.close()
      await fixture.stop()
    }
  }, 30_000)
})
