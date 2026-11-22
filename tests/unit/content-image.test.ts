import { describe, expect, it } from 'vitest'
import { contentImageDimensions, contentImageSizes, contentImageSources, contentImageSrcset, fallbackContentImage } from '../../utils/contentImage'
import type { MediaRecord } from '../../types/content'

describe('automatic uncropped content images', () => {
  const file = { mime_type: 'image/jpeg', width: 2400, height: 4000, variants: {
    thumbnail: { width: 360, height: 360, path: 'thumbnail' }, medium: { width: 576, height: 960, path: 'medium' }, large: { width: 900, height: 1500, path: 'large' }
  } } as MediaRecord
  it('uses actual fit-inside widths, not bounding-box profile labels or thumbnails', () => {
    const sources = contentImageSources(file, '/media/example')
    expect(contentImageSrcset(sources, '/media/example', size => `/media/example?variant=${size}`)).toBe('/media/example?variant=medium 576w, /media/example?variant=large 900w, /media/example 2400w')
  })
  it.each(['image/gif', 'image/webp', 'image/avif', 'image/svg+xml'])('preserves potentially animated/vector %s originals', mime_type => {
    expect(contentImageSources({ ...file, mime_type }, '/media/example')).toBeNull()
  })
  it('discards stale metadata after a source change and safely handles missing metadata', () => {
    expect(contentImageSrcset(contentImageSources(file, '/media/old'), '/media/new', size => size)).toBeUndefined()
    expect(contentImageSources({ ...file, variants: undefined }, '/media/example')).toBeNull()
    expect(contentImageSources({ ...file, variants: { medium: { width: 960, height: 576, path: 'rotated' } } } as MediaRecord, '/media/example')).toBeNull()
  })
  it('exposes intrinsic dimensions for responsive image layout', () => {
    expect(contentImageDimensions({ naturalWidth: 1802, naturalHeight: 884 })).toEqual({ width: 1802, height: 884 })
    expect(contentImageDimensions({ mediaNaturalWidth: '640', mediaNaturalHeight: '360' }, true)).toEqual({ width: 640, height: 360 })
    expect(contentImageDimensions({ naturalWidth: 0, naturalHeight: 884 })).toBeNull()
    expect(contentImageDimensions({ naturalWidth: 'bad', naturalHeight: 884 })).toBeNull()
    expect(contentImageDimensions({}))
      .toBeNull()
  })
  it('only uses sizes=auto when intrinsic dimensions can anchor the ratio', () => {
    expect(contentImageSizes('full')).toContain('auto, ')
    expect(contentImageSizes('full', false)).not.toContain('auto')
    expect(contentImageSizes('small', false)).toContain('33.33vw')
  })
  it('removes srcset on error exactly once to retry original, not an endless loop', () => {
    const attributes = new Map([['src', '/media/example'], ['srcset', 'broken 900w'], ['sizes', '100vw']])
    const target = { hasAttribute: (name: string) => attributes.has(name), removeAttribute: (name: string) => attributes.delete(name), getAttribute: (name: string) => attributes.get(name), src: 'broken' }
    fallbackContentImage({ target } as unknown as Event)
    expect(target.src).toBe('/media/example')
    expect(attributes.has('srcset')).toBe(false)
    fallbackContentImage({ target } as unknown as Event)
    expect(target.src).toBe('/media/example')
  })
})
