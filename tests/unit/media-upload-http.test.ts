import { createServer, request as httpRequest } from 'node:http'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp, createError, defineEventHandler, toNodeListener } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mediaUploadBudget } from '../../server/utils/media-upload'
const mocks = vi.hoisted(() => ({auth: vi.fn(), publish: vi.fn()}))
vi.mock('../../server/utils/auth', () => ({requireOwner: mocks.auth}))
vi.mock('../../server/utils/db', () => ({useDb: async () => ({})}))
vi.mock('../../server/utils/settings', () => ({getMediaSettings: async () => ({max_files_per_upload: 2.5, max_file_size_mb: 64.5 / 1024 / 1024})}))
vi.mock('../../server/utils/mediaLibrary', () => ({mediaCreateOrReuseFileRecord: mocks.publish}))
let root: string | undefined, server: ReturnType<typeof createServer> | undefined, cwd: ReturnType<typeof vi.spyOn> | undefined
afterEach(async () => {
  if (server) {server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve()))}
  cwd?.mockRestore(); if (root) await rm(root, {recursive: true, force: true, maxRetries: 5, retryDelay: 50})
  vi.unstubAllGlobals(); root = undefined; server = undefined
})
async function setup(admin = false) {
  vi.stubGlobal('defineEventHandler', defineEventHandler); vi.stubGlobal('createError', createError)
  root = await mkdtemp(join(tmpdir(), 'pb-media-http-')); cwd = vi.spyOn(process, 'cwd').mockReturnValue(root)
  mocks.auth.mockReset().mockResolvedValue({id: 'users:admin', username: 'admin'})
  mocks.publish.mockReset().mockImplementation(async (_db, file) => ({status: 'created', record: {hash: file.hash, original_name: file.originalName}}))
  const handler = admin ? (await import('../../server/api/admin/upload.post')).default : (await import('../../server/api/media/upload.post')).default
  const app = createApp(); app.use('/upload', handler); server = createServer(toNodeListener(app))
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as {port: number}).port
  return async (body: string) => new Promise<{status: number, body: string}>((resolve, reject) => {
    const request = httpRequest({host: '127.0.0.1', port, path: '/upload', method: 'POST', headers: {'content-type': 'multipart/form-data; boundary=fixture'}}, response => {
      let output = ''
      response.on('data', chunk => {output += chunk.toString()}); response.on('end', () => resolve({status: response.statusCode!, body: output}))
    })
    request.on('error', reject)
    // No Content-Length: actual IncomingMessage, counted chunked ingestion.
    for (let index = 0; index < body.length; index += 7) request.write(body.slice(index, index + 7))
    request.end()
  })
}
const part = (data: string) => `--fixture\r\nContent-Disposition: form-data; name="files"; filename="ordinary.txt"\r\nContent-Type: text/plain\r\n\r\n${data}\r\n`
const end = '--fixture--\r\n'
describe('real H3 media/admin streaming boundary on owned temp storage', () => {
  it.each([false, true])('keeps the response contract and passes paths, not Buffers (admin=%s)', async admin => {
    const send = await setup(admin), result = await send(part('hello') + '--fixture\r\nContent-Disposition: form-data; name="visibility"\r\n\r\nprivate\r\n' + end)
    expect(result.status).toBe(200)
    expect(JSON.parse(result.body)).toMatchObject(admin ? {original_name: 'ordinary.txt'} : {results: [{status: 'created'}]})
    expect(mocks.publish.mock.calls[0]![1]).toMatchObject({size: 5, originalName: 'ordinary.txt', visibility: 'private'})
    expect(mocks.publish.mock.calls[0]![1].data).toBeUndefined()
    expect(await readdir(join(root!, 'storage/media-stage'))).toEqual([])
    expect(mediaUploadBudget.diagnostics()).toMatchObject({active: 0, bytes: 0})
  })
  it('rejects oversized chunked ingestion before any publication and closes writers', async () => {
    const send = await setup(), result = await send(part('x'.repeat(65)) + end)
    expect(result.status).toBe(413); expect(mocks.publish).not.toHaveBeenCalled()
    expect(await readdir(join(root!, 'storage/media-stage'))).toEqual([])
    expect(mediaUploadBudget.diagnostics()).toMatchObject({active: 0, bytes: 0})
  })
  it('authenticates before touching body staging', async () => {
    const send = await setup(); mocks.auth.mockRejectedValue(createError({statusCode: 403, message: 'Forbidden'}))
    expect((await send(part('hello') + end)).status).toBe(403)
    expect(await readdir(root!)).toEqual([])
  })
})
