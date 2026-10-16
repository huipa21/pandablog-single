import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({root: '', requireOwner: vi.fn(), acquireJob: vi.fn(), releaseJob: vi.fn(), receiveBackupUpload: vi.fn(), importExternalBackup: vi.fn()}))
vi.mock('../../../server/utils/auth', () => mocks)
vi.mock('../../../server/utils/backups/jobMutex', () => mocks)
vi.mock('../../../server/utils/backups/upload', () => mocks)
vi.mock('../../../server/utils/backups/importExternal', () => mocks)
vi.mock('../../../server/utils/backups/config', () => ({get BACKUPS_ROOT() {return mocks.root}}))
const token = 'a'.repeat(48)
beforeEach(async () => {
  vi.resetAllMocks(); mocks.root = await mkdtemp(join(tmpdir(), 'pb-import-ownership-'))
  mocks.acquireJob.mockResolvedValue({id: 'owned_import', token, kind: 'import'})
  mocks.releaseJob.mockResolvedValue(undefined)
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('setResponseHeader', vi.fn())
})
afterEach(async () => {vi.unstubAllGlobals(); await rm(mocks.root, {recursive: true, force: true})})
describe('import route exclusive stage ownership (real filesystem, mocked body/auth/job)', () => {
  it('never removes an existing unowned upload stage after exclusive mkdir refusal', async () => {
    const stage = join(mocks.root, `.upload-${token}`); await mkdir(stage); await writeFile(join(stage, 'unknown'), 'preserve')
    const {default: handler} = await import('../../../server/api/admin/backups/import.post')
    await expect(handler({} as H3Event)).rejects.toMatchObject({code: 'EEXIST'})
    expect(await readFile(join(stage, 'unknown'), 'utf8')).toBe('preserve')
    expect(mocks.receiveBackupUpload).not.toHaveBeenCalled()
    expect(mocks.importExternalBackup).not.toHaveBeenCalled()
    expect(mocks.releaseJob).toHaveBeenCalledOnce()
  })
  it('removes only a successfully created stage after settled ingestion failure, then releases ownership', async () => {
    mocks.receiveBackupUpload.mockRejectedValue(new Error('settled ingestion failure'))
    const {default: handler} = await import('../../../server/api/admin/backups/import.post')
    await expect(handler({node: {req: {}}} as H3Event)).rejects.toThrow('settled ingestion failure')
    expect(await readdir(mocks.root)).toEqual([])
    expect(mocks.releaseJob).toHaveBeenCalledOnce()
  })
})
