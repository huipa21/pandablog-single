import { requireOwner } from '../../../utils/auth'

/**
 * Build identity for the admin UI.
 *
 * Admin-gated on purpose: publishing the exact build of a public site lets an
 * attacker match it against known vulnerabilities. The same value is available
 * inside the container via `panda version`.
 */
export default defineEventHandler(async (event) => {
  await requireOwner(event)

  const version = useRuntimeConfig(event).appVersion || ''
  const current = /^(\d{8})T\d{6}Z-g([0-9a-f]{12})(?:\.dirty)?$/.exec(version)
  // Keep old image labels readable during the transition. Explicit release
  // labels are displayed verbatim without inventing date or commit metadata.
  const legacy = /^(\d{6})-(\d+)\+g([0-9a-f]{7,40})(?:\.dirty)?$/.exec(version)

  return {
    version,
    date: current?.[1] ?? legacy?.[1] ?? null,
    sequence: legacy?.[2] ? Number(legacy[2]) : null,
    commit: current?.[2] ?? legacy?.[3] ?? null,
    dirty: version.endsWith('.dirty'),
    node: process.version
  }
})
