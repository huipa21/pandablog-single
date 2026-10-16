import { describe, expect, it } from 'vitest'
import { mediaRecordVisibleToUser, mediaRecordManageableByUser } from '../../server/utils/mediaPermissions'
import { mediaNormalizeFileRecord } from '../../server/utils/mediaLibrary'

const owner = {id: 'users:admin', username: 'admin'}
describe('media projection fail-closed policy', () => {
  it('missing visibility cannot normalize to public or authorize the owner', () => {
    const projected = mediaNormalizeFileRecord({id: `files:${'a'.repeat(64)}`, original_name: 'private-fixture'})
    expect(mediaRecordVisibleToUser(projected, null)).toBe(false)
    expect(mediaRecordManageableByUser(projected, owner)).toBe(false)
  })
  it('anonymous visitors cannot read private metadata; explicit public and owner remain usable', () => {
    const privateFile = mediaNormalizeFileRecord({id: `files:${'a'.repeat(64)}`, visibility: 'private'})
    expect(mediaRecordVisibleToUser(privateFile, null)).toBe(false)
    expect(mediaRecordVisibleToUser(privateFile, owner)).toBe(true)
    expect(mediaRecordVisibleToUser({...privateFile, visibility: 'public'}, null)).toBe(true)
  })
})
