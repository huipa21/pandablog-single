# Feature-flag simplification: acceptance matrix

**Status: executed locally on 2026-10-10. All rows pass except A2 (blocked on E2E credentials) and C3 (partially covered); see the summary in progress.md.** Record actual results in [progress.md](./progress.md). A row passes only with real execution evidence: command, versions and counts. Reading the source is not evidence.

## A. Rendering and editor (FF-01, FF-02)

| ID | Required proof | Evidence type |
|---|---|---|
| A1 | `ContentRenderer.vue` has no `__PB_*`, `disabledBlockTypes` or "Disabled content block" path, and defines all 18 node components unconditionally | `tests/unit/feature-flags-retired.test.ts` |
| A2 | A post containing every block type renders every block on the public page in a production build | `tests/e2e/all-blocks-parity.spec.ts` against an owned app if E2E credentials are available; otherwise the FF-07 harness browser profile plus manual note. Record as blocked if neither ran |
| A3 | The editor inserter/slash menu lists every non-hidden block definition. The dialogue "convert" toolbar action and dialogue settings are present | Unit check that `useBlockRegistry` exposes every `blockDefinitions` entry; e2e `block-editor.spec.ts`/`dialogue-controls.spec.ts` if available |
| A4 | Opening and saving a post that contains dialogue, mermaid, math, annotation and table content preserves its JSON | Existing `dialogueBlock.test.ts`/`blocks.test.ts` pass; e2e if available |
| A5 | `/api/admin/annotate` works for a content manager and still enforces auth, the 5,000-character limit and zod validation | Existing annotate tests pass; no module-404 path remains |
| A6 | `DisabledDialogueBlockNodeView.vue` and the `admin.editor.dialogue.disabled` i18n key are gone from both locales; both locale files are valid JSON | `rg` + `node -e "JSON.parse(...)"` |

## B. Server always-on behavior (FF-03)

| ID | Required proof | Evidence type |
|---|---|---|
| B1 | The error hook, error-group flush, log retention, logger and admin log APIs no longer consult module flags. Runtime logging settings (`enabled`, `activity_log_enabled`, `error_log_enabled`) still gate behavior | Updated logging unit tests pass, including the existing runtime-setting cases |
| B2 | Analytics rollup is always registered. `analytics_enabled=false` still stops collection (except post view counts, as today). GeoIP returns empty geo when the file is missing | Existing analytics tests pass; geo unit behavior unchanged |
| B3 | **Superseded by the single-owner simplification:** only `users:admin` can hold a session; no role checks or user management remain | `current-identity*.test.ts`, `password-routes.test.ts`; middleware source check |
| B4 | The MFA login challenge, enrollment enforcement and device APIs are always active and still require authentication | Existing MFA/login tests pass; device APIs no longer 404 |
| B5 | Security alerts are gated only by `security_alerts_enabled` and the webhook URL | `security-alerts-bounded.test.ts` |
| B6 | `loadSchema()` returns the raw `schema.surql` and the hash equals `sha256(raw)`. `schema.surql` is unchanged (`git diff --quiet -- server/utils/schema.surql`) | `schema.test.ts` + git |
| B7 | db-init always initializes analytics/logging settings, marks analytics ready and runs the error-group backfill; restore `refreshState` always reloads them | `runtime-startup.test.ts`, `backup-restore-schema.test.ts`; guarded real-DB fixture |
| B8 | Post versioning always snapshots on change for versioned posts. No code path deletes history because of a flag | `blocks.test.ts` and posts API tests; `rg collapsePost server` empty |
| B9 | Real database boot, schema apply, backup and restore still pass | `node --import tsx scripts/backend-hardening/run.ts --fixture --surreal-bin=<3.2.x>` |

## C. Public features (FF-04)

| ID | Required proof | Evidence type |
|---|---|---|
| C1 | `graph_view_enabled`/`publish_heatmap_enabled` are public keys. Normalization defaults to `true`; non-booleans are coerced on write | `public-features-settings.test.ts` |
| C2 | When `false`, the four graph APIs and `/api/posts/publish-frequency` return 404. When `true` or absent, they work | Unit test of `assertPublicFeatureEnabled` + harness HTTP check (spec 03 §6.1 step 7) |
| C3 | When `false`, the home graph widget, post knowledge graph and home heatmap are not rendered (no heatmap fetch), and `/graph` is a 404 page | Harness/browser check or manual production-build check, recorded with steps |
| C4 | The General settings "Public features" section loads, saves and reloads both toggles in en and zh-CN | Harness browser profile or manual check; locale JSON valid |
| C5 | Saving settings invalidates the bootstrap cache. The API changes immediately; cached home HTML may lag ≤ ~2 min | Harness HTTP check; documented in operations |

## D. Machinery removal (FF-05, FF-06)

| ID | Required proof | Evidence type |
|---|---|---|
| D1 | No `__PB_*`, `moduleFlags`, `useModuleFlags`, `pandablog-modules` or `public.modules` reference in production paths | Repository-wide guard test (spec 03 §5.1) |
| D2 | The deleted files are absent; `package.json` has no `configure`/`modules:print`; `.gitignore` allow-list lines removed; the Dockerfile has no manifest step | Guard test + `rg` |
| D3 | The legacy manifest helper lists `false` paths (ignoring `accessLogs`), never throws, and is bounded | `legacy-module-manifest.test.ts` |
| D4 | `npm run build` succeeds without a manifest (no warning), and with a temporary manifest containing `false` (warning printed, build succeeds) | Two recorded build runs; temporary manifest removed |
| D5 | The emitted production server contains no `__PB_MODULE_`/`__PB_BLOCK_` identifiers | Harness emitted-code scan (spec 03 §6.1 step 5) |

## E. Combined quality and handoff (FF-07)

- Supported Node 22: `npm run lint`, `npm run typecheck`, `npm run test:unit` and `git diff --check` all pass. Record exact counts. Record the known timing flakes separately and do not weaken them.
- Guarded stable SurrealDB 3.2.x fixture passes (B9).
- One owned production build/browser profile `--profile=full --mode=build` passes, including C2–C4 and D5. It uses an owned source copy without the user's `.env`/`storage/`.
- README and the cross-link notes match the implemented behavior (spec 03 §7). Local Markdown links resolve.
- progress.md lists changed files, deleted test cases per file, results, blockers and next action. It states that no user data, deployment or commit was touched.

Missing environments (E2E credentials, DB binary, browser) are recorded as **blocked**, never as passed.
