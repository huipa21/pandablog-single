import { defineConfig } from 'vitest/config'
import base from './vitest.config'

// Do not merge array-valued includes: only explicitly guarded live suites are eligible.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['tests/integration/backend-hardening.test.ts', 'tests/integration/db-lifecycle.test.ts', 'tests/integration/database-bootstrap.test.ts', 'tests/integration/backup-streaming.test.ts', 'tests/integration/backup-restore.test.ts', 'tests/integration/media-storage-startup.test.ts', 'tests/integration/current-identity.test.ts', 'tests/integration/media-privacy.test.ts', 'tests/integration/media-phase3.test.ts', 'tests/integration/media-dashboard-tags.test.ts', 'tests/integration/analytics-phase4.test.ts', 'tests/integration/geoip-removal.test.ts', 'tests/integration/setup.test.ts', 'tests/unit/error-groups-live.test.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000
  }
})
