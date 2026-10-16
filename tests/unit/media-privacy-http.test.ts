import { createReadStream } from 'node:fs'
import { createServer } from 'node:http'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createApp, createError, createRouter, defineEventHandler, getCookie, getQuery, getRequestURL, getRouterParam, sendRedirect, sendStream, setResponseHeader, setResponseHeaders, toNodeListener, type H3Event } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOwnedStorage } from '../../scripts/backend-hardening/fixture'
import { MediaArchiveStore } from '../../server/utils/media-archives'

const state = vi.hoisted(() => ({root: '', records: [] as Record<string, unknown>[], store: null as MediaArchiveStore | null, site: 'public', epoch: 'a'.repeat(48), queries: [] as string[]}))
// Only the owner can hold a session; any other cookie value is an anonymous request.
const actor = (event: H3Event) => getCookie(event, 'actor') === 'fixture' ? {id: 'users:admin', username: 'admin'} : null
vi.mock('../../server/utils/auth', () => ({
  getSessionUser: async (event: H3Event) => actor(event), isOwner: async (event: H3Event) => Boolean(actor(event)),
  requireOwner: async (event: H3Event) => {const user = actor(event); if (!user) throw createError({statusCode: 401}); return user},
  getRequestAuthAccount: async () => ({active: true, auth_epoch: state.epoch})
}))
vi.mock('../../server/utils/visibility', () => ({getSiteVisibility: async () => state.site}))
vi.mock('../../server/utils/settings', () => ({getMediaSettings: async () => ({download_cleanup_hours: 1})}))
vi.mock('../../server/utils/mediaAccess', () => ({assertLocalMediaRequest: async () => {}, assertSameSiteMediaRequest: async () => {}}))
vi.mock('../../server/utils/fileStorage', () => ({
  mediaStatOriginal: (path: string) => stat(join(state.root, path)), mediaStatVariant: (path: string) => stat(join(state.root, path)),
  mediaCreateOriginalStream: (path: string) => createReadStream(join(state.root, path)), mediaCreateVariantStream: (path: string) => createReadStream(join(state.root, path)),
  mediaStoredFilename: () => 'fixture', mediaVariantRelativePath: () => 'variant.bin'
}))
vi.mock('../../server/utils/db', () => ({
  useDb: async () => ({}), queryDbRecord: async (_db: unknown, _table: string, hash: string) => state.records.find(record => record.hash === hash),
  queryDb: async (_db: unknown, sql: string, params: {hashes: string[]}) => {state.queries.push(sql); return [state.records.filter(record => params.hashes.includes(String(record.hash)))]}
}))
vi.mock('../../server/utils/media-archives', async original => ({...await original<typeof import('../../server/utils/media-archives')>(), mediaArchiveStore: () => state.store!}))
afterEach(() => vi.unstubAllGlobals())

describe('real H3 media + shared-cache fixture (owned bytes only)', () => {
  it('private originals/variants/site mode, removed IPX routes, and archive owner/policy cannot leak through shared cache', async () => {
    const owned = await createOwnedStorage()
    state.root = owned.path('sources'); await mkdir(state.root)
    await writeFile(join(state.root, 'original.txt'), 'private original fixture bytes')
    await writeFile(join(state.root, 'second.txt'), 'second fixture bytes')
    await writeFile(join(state.root, 'variant.bin'), 'private variant fixture bytes')
    state.store = new MediaArchiveStore(owned.path('downloads'), state.root)
    const hash = 'a'.repeat(64), second = 'b'.repeat(64)
    state.records = [
      {id: `files:${hash}`, hash, original_name: 'original.txt', original_path: 'original.txt', mime_type: 'text/plain', visibility: 'private', variants: {thumbnail: {path: 'variant.bin', mime_type: 'image/webp'}}},
      {id: `files:${second}`, hash: second, original_name: 'second.txt', original_path: 'second.txt', visibility: 'public'}
    ]
    for (const [name, value] of Object.entries({defineEventHandler, createError, getQuery, getRouterParam, getRequestURL, sendRedirect, sendStream, setResponseHeader, setResponseHeaders})) vi.stubGlobal(name, value)
    const {serveOriginalMedia, serveMediaVariant} = await import('../../server/utils/mediaServe')
    const {default: createArchive} = await import('../../server/api/media/download.post')
    const {default: getArchive} = await import('../../server/api/media/download/[filename].get')
    const {default: siteGuard} = await import('../../server/middleware/site-visibility')
    const router = createRouter()
    router.get('/media/:id', defineEventHandler(event => serveOriginalMedia(event, getRouterParam(event, 'id')!)))
    router.get('/api/media/variant/:id', defineEventHandler(event => serveMediaVariant(event, getRouterParam(event, 'id')!, 'thumbnail')))
    router.post('/api/media/download', createArchive)
    router.get('/api/media/download/:filename', getArchive)
    const app = createApp(); app.use(defineEventHandler(event => {setResponseHeader(event, 'Vary', 'Origin')})); app.use(siteGuard); app.use(router)
    const server = createServer(toNodeListener(app))
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as {port: number}).port}`
    const cache = new Map<string, {status: number, body: string}>()
    const proxy = async (path: string, user?: string) => {
      if (cache.has(path)) return cache.get(path)!
      const response = await fetch(base + path, {headers: user ? {cookie: `actor=${user}`} : {}, redirect: 'manual'})
      const body = await response.text()
      if (response.headers.get('cache-control')?.includes('public')) cache.set(path, {status: response.status, body})
      if (response.status === 200) {expect(response.headers.get('cache-control')).toBe('private, no-store'); expect(response.headers.get('vary')).toContain('Cookie'); expect(response.headers.get('vary')).toContain('Origin')}
      return {status: response.status, body}
    }
    try {
      expect((await proxy(`/media/${hash}`, 'fixture')).body).toContain('private original')
      state.records[0]!.mime_type = 'image/svg+xml'
      const activeContent = await fetch(`${base}/media/${hash}`, {headers: {cookie: 'actor=fixture'}})
      expect(activeContent.headers.get('content-disposition')).toContain('attachment')
      expect(activeContent.headers.get('content-security-policy')).toContain('sandbox')
      expect(activeContent.headers.get('x-content-type-options')).toBe('nosniff')
      await activeContent.arrayBuffer()
      state.records[0]!.mime_type = 'text/plain'
      expect((await proxy(`/media/${hash}`)).status).toBe(404)
      expect((await proxy(`/api/media/variant/${hash}`, 'fixture')).body).toContain('private variant')
      expect((await proxy(`/api/media/variant/${hash}`)).status).toBe(404)
      state.records[0]!.visibility = 'public'
      expect((await proxy(`/media/${hash}`)).status).toBe(200)
      state.records[0]!.visibility = 'private'
      expect((await proxy(`/media/${hash}`)).status).toBe(404)
      state.site = 'private'
      expect((await proxy(`/media/${second}`)).status).toBe(302)
      expect((await proxy(`/api/media/variant/${hash}`)).status).toBe(401)
      // Legacy transform URLs are not a private-site routing exemption anymore.
      const legacyIpxPaths = [
        `/_ipx/_/media/${hash}`,
        `/_ipx/_/https%3A%2F%2Fexample.com%2Fapi%2Fmedia%2Ffile%2F${hash}`,
        '/_ipx/w_100/favicon.ico'
      ]
      for (const path of legacyIpxPaths) {
        expect((await proxy(path)).status).toBe(302)
        expect((await proxy(path, 'fixture')).status).toBe(404)
      }
      state.site = 'public'
      for (const path of legacyIpxPaths) {
        expect((await proxy(path)).status).toBe(404)
        expect((await proxy(path, 'fixture')).status).toBe(404)
      }
      const make = (user: string) => fetch(`${base}/api/media/download`, {method: 'POST', headers: {cookie: `actor=${user}`, 'content-type': 'application/json'}, body: JSON.stringify({hashes: [hash, second]})})
      expect((await make('other')).status).toBe(401)
      const created = await make('fixture'); expect(created.status).toBe(200)
      const {url} = await created.json()
      expect((await proxy(url, 'other')).status).toBe(401)
      expect((await proxy(url, 'fixture')).status).toBe(200)
      state.records[1]!.storage_state = 'deleting'
      expect((await proxy(url, 'fixture')).status).toBe(404) // ready ZIP rechecks mutable source policy
      delete state.records[1]!.storage_state; state.epoch = 'b'.repeat(48)
      expect((await proxy(url, 'fixture')).status).toBe(404)
      expect(cache.size).toBe(0)
      expect(state.queries.every(sql => sql.includes('visibility') && sql.includes('storage_state') && sql.includes('LIMIT 200'))).toBe(true)
    } finally {state.site = 'public'; state.epoch = 'a'.repeat(48); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await owned.cleanup()}
  })
})
