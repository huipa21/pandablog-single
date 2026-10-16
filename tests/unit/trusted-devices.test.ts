import { describe, expect, it } from 'vitest'
import { deriveDeviceLabel, trustedDeviceContextMatches, trustedDeviceExpiry, trustedDeviceIpPrefix, type TrustedDeviceContext, type TrustedDeviceRecord } from '../../server/utils/mfa/trusted-devices'

function device(overrides: Partial<TrustedDeviceRecord> = {}): TrustedDeviceRecord {
  return {
    id: 'trusted_devices:test',
    userId: 'user:test',
    tokenHash: 'hash',
    authEpoch: 'a'.repeat(48),
    label: 'Chrome on Windows',
    userAgent: 'ua',
    uaHash: 'ua-hash',
    ip: '203.0.113.45',
    ipPrefix: '203.0.113.0/24',
    createdAt: '2026-07-01T00:00:00.000Z',
    lastUsedAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2026-07-31T00:00:00.000Z',
    ...overrides
  }
}

function context(overrides: Partial<TrustedDeviceContext> = {}): TrustedDeviceContext {
  return {
    userAgent: 'ua',
    uaHash: 'ua-hash',
    ip: '203.0.113.55',
    ipPrefix: '203.0.113.0/24',
    ...overrides
  }
}

describe('trusted device helpers', () => {
  it('matches by user agent hash and IP prefix', () => {
    expect(trustedDeviceContextMatches(device(), context())).toBe(true)
    expect(trustedDeviceContextMatches(device(), context({ ipPrefix: '198.51.100.0/24' }))).toBe(false)
    expect(trustedDeviceContextMatches(device(), context({ uaHash: 'other' }))).toBe(false)
  })

  it('requires both sides to lack an IP prefix to match without one', () => {
    expect(trustedDeviceContextMatches(device({ ipPrefix: null }), context({ ipPrefix: null }))).toBe(true)
    expect(trustedDeviceContextMatches(device({ ipPrefix: null }), context())).toBe(false)
    expect(trustedDeviceContextMatches(device(), context({ ipPrefix: null }))).toBe(false)
  })

  it('derives stable network prefixes', () => {
    expect(trustedDeviceIpPrefix('203.0.113.45')).toBe('203.0.113.0/24')
    expect(trustedDeviceIpPrefix('2001:db8:abcd:1234::1')).toBe('2001:db8:abcd::/48')
    expect(trustedDeviceIpPrefix('not-an-ip')).toBeNull()
  })

  it('derives readable device labels from common user agents', () => {
    expect(deriveDeviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36')).toBe('Chrome on Windows')
    expect(deriveDeviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15')).toBe('Safari on macOS')
    expect(deriveDeviceLabel(null)).toBe('Unknown device')
  })

  it('computes expiry as a Date ~30 days out (never an ISO string)', () => {
    const now = new Date('2026-07-01T00:00:00.000Z')
    const expiry = trustedDeviceExpiry(now)
    // Must be a real Date so SurrealDB can coerce the schemafull `datetime` field.
    expect(expiry).toBeInstanceOf(Date)
    expect(typeof expiry).not.toBe('string')
    expect(expiry.getTime() - now.getTime()).toBe(30 * 24 * 60 * 60 * 1000)
  })
})