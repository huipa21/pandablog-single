import type { MediaRecord } from '~/types/content'
import { extractMediaHash } from '~/composables/useMediaUrl'
import { imagePreset } from '~/utils/blockPresentation'

export interface ContentImageSources {
  src: string
  width: number
  variants: Array<{ size: 'medium' | 'large', width: number }>
}
export interface ContentImageDimensions { width: number, height: number }
/** Intrinsic dimensions are metadata only; never alternate display sizing state. */
export function contentImageDimensions(attrs: Record<string, unknown> | null | undefined, media = false): ContentImageDimensions | null {
  const width = Number(attrs?.[media ? 'mediaNaturalWidth' : 'naturalWidth'])
  const height = Number(attrs?.[media ? 'mediaNaturalHeight' : 'naturalHeight'])
  return Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0 ? { width, height } : null
}
/** Only known non-animated raster formats; never the cover-cropped thumbnail. */
export function contentImageSources(file: MediaRecord, src: string): ContentImageSources | null {
  if (!['image/jpeg', 'image/png'].includes(file.mime_type) || !file.width || !extractMediaHash(src)) return null
  const variants: ContentImageSources['variants'] = []
  for (const size of ['medium', 'large'] as const) {
    const variant = file.variants?.[size]
    if (variant?.width && variant.height && file.height && variant.path) {
      // Rotated originals have different geometry in generated variants. Without
      // projected orientation metadata, conservatively retain the original.
      if (Math.abs(variant.width / variant.height - file.width / file.height) > 0.02) return null
      variants.push({ size, width: variant.width })
    }
  }
  return variants.length ? { src, width: file.width, variants } : null
}
export function contentImageSrcset(raw: unknown, src: string, variantUrl: (size: string) => string): string | undefined {
  const data = raw as ContentImageSources | null
  if (!data || data.src !== src || !Number.isFinite(data.width) || data.width <= 0 || !Array.isArray(data.variants)) return undefined
  const widths = new Map<number, string>([[data.width, src]])
  for (const variant of data.variants.slice(0, 2)) {
    if (variant && ['medium', 'large'].includes(variant.size) && Number.isFinite(variant.width) && variant.width > 0 && variant.width < data.width) widths.set(variant.width, variantUrl(variant.size))
  }
  return widths.size > 1 ? [...widths].sort(([a], [b]) => a - b).map(([width, url]) => `${url} ${width}w`).join(', ') : undefined
}
export function contentImageSizes(preset: unknown, useAuto = true): string {
  const width = imagePreset(preset) === 'small' ? 33.33 : imagePreset(preset) === 'medium' ? 66.67 : 100
  // Lazy images let the browser use the actual nested container width; the
  // remaining list is a safe fallback for browsers without sizes=auto. The
  // intrinsic width/height attrs must accompany this because Chrome otherwise
  // lays out a percentage-width srcset image at the replaced-element fallback
  // size (300x150) instead of the image ratio. Without intrinsic metadata,
  // omit auto so that browser fallback can still preserve the image ratio.
  return `${useAuto ? 'auto, ' : ''}(max-width: 48rem) 100vw, ${width}vw`
}
/** A selected stale srcset candidate does not automatically fall back to src. */
export function fallbackContentImage(event: Event) {
  const img = event.target as HTMLImageElement
  if (!img.hasAttribute('srcset')) return
  img.removeAttribute('srcset')
  img.removeAttribute('sizes')
  img.src = img.getAttribute('src') ?? ''
}
