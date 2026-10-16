import { describe, expect, it } from 'vitest'
import { resolveLoginRedirect, safeInternalPath } from '../../utils/authRedirect'

describe('safeInternalPath', () => {
  it('keeps same-origin paths', () => {
    expect(safeInternalPath('/admin/dashboard', '/')).toBe('/admin/dashboard')
  })

  it('rejects external and protocol-relative paths', () => {
    expect(safeInternalPath('https://example.test', '/fallback')).toBe('/fallback')
    expect(safeInternalPath('//example.test/path', '/fallback')).toBe('/fallback')
  })

  it('rejects backslash protocol smuggling paths', () => {
    expect(safeInternalPath('/\\example.test/path', '/fallback')).toBe('/fallback')
  })
})

describe('resolveLoginRedirect', () => {
  it('sends the owner to the dashboard when no redirect is supplied', () => {
    expect(resolveLoginRedirect(undefined)).toBe('/admin/dashboard')
  })

  it('preserves safe redirects', () => {
    expect(resolveLoginRedirect('/admin/posts')).toBe('/admin/posts')
    expect(resolveLoginRedirect('/blog/hello')).toBe('/blog/hello')
  })

  it('falls back safely for unsafe redirects', () => {
    expect(resolveLoginRedirect('https://example.test')).toBe('/admin/dashboard')
    expect(resolveLoginRedirect('//example.test')).toBe('/admin/dashboard')
  })
})