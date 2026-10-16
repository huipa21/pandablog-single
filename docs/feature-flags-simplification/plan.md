# Feature-flag simplification: implementation plan

**Status: implemented in the working tree (FF-00 to FF-07) and verified locally; not committed or deployed.** The user approved every recommended decision in section 2 and then requested implementation. Read [progress.md](./progress.md) first for results and the small recorded deviations. Record implementation and evidence there, not by rewriting this plan.

This package is written so that a smaller or local LLM can implement it one task at a time. Every task lists exact files, exact edits, a self-check command and a "done when" condition. **Do the tasks in order.** Do not skip the self-checks.

## 1. Goal in plain words

PandaBlog currently compiles **two kinds** of build:

1. `pandablog.modules.json` lists about 40 on/off switches (11 modules + 20 editor blocks + 4 themes + sub-switches).
2. `modules/feature-flags.ts` reads that file at build time and:
   - injects compile-time constants such as `__PB_MODULE_LOGS__` and `__PB_BLOCK_MERMAID__` into Vite and Nitro,
   - publishes the same values as `runtimeConfig.public.modules`,
   - removes whole routes/pages/plugins from the build with `nuxt.options.ignore`.
3. The code base checks these constants in about 60 files (≈205 references).
4. A web configurator (`npm run configure`), a print script, a JSON schema, TypeScript types and a Dockerfile step support that file.

**Target:** ship **one build that contains every feature**. Only an administrator setting decides whether something optional is active. No build-time switches remain.

There is also a real bug that must be fixed: `components/content/ContentRenderer.vue` refuses to render a block type when its build flag is off. Turning off an editor block therefore hides content in **existing published posts**. After this change, **every known block type always renders**.

## 2. Approved decisions

| ID | Feature (old manifest key) | New behavior | Where the admin controls it |
|---|---|---|---|
| FF-D01 | `editor.enabled`, `editor.blocks.*` (20 blocks) | Always available in the editor; **always rendered** on public pages | No setting (not needed) |
| FF-D02 | `logs.enabled`, `logs.activityLogs`, `logs.errorLogs` | Always compiled in | Existing Logs settings page (`enabled`, `activity_log_enabled`, `error_log_enabled`) |
| FF-D03 | `analytics.enabled`, `analytics.geoip` | Always compiled in | Existing `analytics_enabled` setting (default **off**). GeoIP is active only if the operator places the `.mmdb` file |
| FF-D04 | `users.enabled`, `users.multiUser` | **Superseded:** the app is now single-owner only (`users:admin`); roles, user management and per-author ownership were removed | Not applicable |
| FF-D05 | `themes.enabled`, `themes.bundled.*` | All bundled themes always shipped (~100 KB total); theme management always available | Existing Themes settings page |
| FF-D06 | `mfa.enabled` | Always available; the owner opts in | Existing MFA + `security_mfa_required_for_admins` (now means "require MFA for the owner") |
| FF-D07 | `securityAlerts.enabled` | Always compiled in | Existing `security_alerts_enabled` (default **off**) |
| FF-D08 | `backups.enabled` | Always available | Existing Backups page |
| FF-D09 | `graphView.enabled` | Compiled in; **new public setting** `graph_view_enabled` (default **on**) | Settings → General → "Public features" |
| FF-D10 | `publishActivityHeatmap.enabled` | Compiled in; **new public setting** `publish_heatmap_enabled` (default **on**) | Settings → General → "Public features" |
| FF-D11 | `postVersioning.enabled` | Always on. The "collapse history when disabled" code is deleted | Existing snapshot limit (Settings → Versioning) |
| FF-D12 | Build-time exclusion | **Removed completely.** The 17 MB annotation dictionary (`public/dict`) is always shipped. GeoIP is not in the image anyway | — |
| FF-D13 | Old manifest files and tools | Delete `pandablog.modules.json`, `pandablog.modules.json.example`, schema, types, configurator, `npm run configure`, `npm run modules:print` | — |
| FF-D14 | A stale `pandablog.modules.json` left by an operator | Build **prints a warning and continues**. It lists every `false` value and points to [operations.md](./operations.md). Never fails the build | — |
| FF-D15 | Database schema | Module sections always apply. **Do not edit `server/utils/schema.surql`**, so the schema hash for existing all-enabled installs stays identical (no re-apply on upgrade) | — |
| FF-D16 | Verification | Lint, typecheck, full unit suite, guarded real-DB fixture, one full production build/browser profile. The 7 module profiles collapse to `full` | — |
| FF-D17 | Delivery | Working tree only. **No commit, push or deployment** | — |

**Out of scope:** new feature toggles beyond FF-D09/FF-D10, a runtime "hide blocks from the inserter" setting, changes to analytics/MFA/backup semantics, schema edits, data migration, changes to other docs' historical evidence.

## 3. What "always on" means for code (the replacement rule)

Almost every change is mechanical. For each reference to a flag that becomes **always true**, replace the flag with `true` in your head and simplify:

| Before | After |
|---|---|
| `if (!FLAG) { return / throw ... }` | delete the whole `if` block |
| `if (!FLAG) return` | delete the line |
| `if (FLAG) { body }` | keep `body`, delete the `if` wrapper (fix indentation) |
| `FLAG && expr` | `expr` |
| `!FLAG \|\| expr` | `expr` |
| `FLAG ? a : b` | `a` |
| `...(FLAG ? [x, y] : [])` | `x, y` |
| `...(FLAG ? [x] : [y])` | `x` (delete `y` and anything only `y` used) |
| `const fooEnabled = FLAG` | delete the constant; apply this table to every use of `fooEnabled` |
| `v-if="fooEnabled"` | delete the attribute |
| `v-if="fooEnabled && cond"` | `v-if="cond"` |
| `v-else-if="Comp && node.type === 'x'"` | `v-else-if="node.type === 'x'"` |

`FLAG` means any of: `__PB_MODULE_*__`, `__PB_BLOCK_*__`, `resolveModuleFlags(...).x`, `useModuleFlags().x`, `moduleFlags.x`, `flags.x` (when `flags` came from `resolveModuleFlags`), `isRuntimeEditorBlockEnabled(...)`, `accountAllowedInModuleMode(...)`.

**Two exceptions are not "always true":**

- Graph view and the publish heatmap become runtime settings (task FF-04).
- Single-user mode is deleted. `multiUser` is treated as `true`, so code inside `if (!multiUserModeEnabled)` is deleted.

After every edit, remove imports that are no longer used. ESLint (`npm run lint`) reports them.

## 4. Source inventory (revision `d878a57`)

Line numbers are hints. Search for the text and re-check before editing.

### 4.1 Machinery that will be deleted (task FF-06)

| File | Role |
|---|---|
| `modules/feature-flags.ts` | Nuxt local module: reads manifest, injects defines, ignores routes, sets `runtimeConfig.public.modules` |
| `build/pandablog-modules.ts` | Defaults, normalization, define generation |
| `types/pandablog-modules.ts`, `types/pandablog-modules.schema.json` | Types and JSON schema |
| `types/module-flags.d.ts` | `declare const __PB_*__: boolean` globals |
| `utils/moduleFlags.ts`, `composables/useModuleFlags.ts` | Runtime flag readers |
| `scripts/configure-modules.ts`, `scripts/configure/index.html`, `scripts/print-modules.ts` | Configurator and print tool |
| `pandablog.modules.json`, `pandablog.modules.json.example` | Manifest files (both tracked in git) |
| `package.json` scripts `configure`, `modules:print` | Tool entry points |
| `.gitignore` allow-list lines for the above scripts/example | Housekeeping |
| `Dockerfile` (RUN step that reads the manifest and deletes themes, ~line 85) | Theme exclusion |
| `nuxt.config.ts` `runtimeConfig.public.modules: {}` | Runtime config slot |

### 4.2 Consumers that must be rewritten first (tasks FF-01 to FF-05)

| Area | Files |
|---|---|
| Public rendering | `components/content/ContentRenderer.vue` |
| Editor | `composables/useBlockRegistry.ts`, `components/admin/editor/blocks/BlockEditor.vue`, `components/admin/editor/BlockToolbar.vue`, `components/admin/editor/blocks/BlockSettings.vue`, `components/admin/editor/PostSettingsModal.vue`, `components/admin/editor/EditorSidebar.vue`, `components/admin/editor/DisabledDialogueBlockNodeView.vue` (delete) |
| Server, logs | `server/plugins/logging-error-hook.ts`, `server/plugins/log-retention.ts`, `server/plugins/error-groups.ts`, `server/utils/logging.ts`, `server/utils/logging-admin.ts`, `server/utils/log-retention.ts`, `server/api/admin/logs/cleanup.post.ts`, `server/api/admin/logs/error-groups/{index.get,[fp].get,bulk.post}.ts` |
| Server, analytics | `server/plugins/analytics-rollup.ts`, `server/utils/analytics/geo.ts` |
| Server, auth/MFA | `server/utils/auth.ts`, `server/utils/mfa/session.ts`, `server/api/auth/login.post.ts`, `server/api/admin/auth/devices/{list.get,rename.post,revoke.post,revoke-all.post}.ts` |
| Server, other | `server/utils/notify/security-alert.ts`, `server/utils/schema.ts`, `server/plugins/db-init.ts`, `server/utils/backups/restore.ts`, `server/utils/blocks.ts`, `server/api/admin/posts/index.post.ts`, `server/api/admin/posts/[id].put.ts`, `server/api/admin/annotate.post.ts` |
| Server, graph/heatmap | `server/api/graph/{overview.get,cluster.get,tag.get}.ts`, `server/api/graph/post/[slug].get.ts`, `server/api/posts/publish-frequency.get.ts` |
| Settings | `server/utils/settings.ts`, `composables/useSiteSettings.ts`, `pages/admin/settings/general.vue`, `i18n/locales/en.json`, `i18n/locales/zh-CN.json` |
| Pages/layout | `pages/index.vue`, `pages/blog/[slug].vue`, `pages/graph.vue`, `pages/login.vue`, `pages/admin/settings/security.vue`, `pages/admin/posts/index.vue`, `pages/admin/posts/[id].vue`, `pages/admin/dashboard/index.vue`, `pages/admin/dashboard/logs/index.vue`, `layouts/admin.vue`, `middleware/admin.global.ts` |
| Tests | ~20 unit/integration tests that stub `__PB_*` globals or mock `utils/moduleFlags` (list in [spec 03](./specs/03-build-tests-docs.md)) |
| Harness | `scripts/backend-hardening/maintenance-app.ts`, `scripts/backend-hardening/maintenance-browser.ts` |
| Docs | `Readme.md`, `docs/dialogue-block/operations.md`, `docs/dialogue-block/specs/00-architecture.md` (narrow cross-link notes only) |

## 5. Specs

| Document | What it contains |
|---|---|
| [specs/00-target-behavior.md](./specs/00-target-behavior.md) | Target behavior, invariants, new settings contract, compatibility rules |
| [specs/01-server-recipes.md](./specs/01-server-recipes.md) | File-by-file server edits with before/after snippets |
| [specs/02-client-recipes.md](./specs/02-client-recipes.md) | File-by-file renderer, editor, page, layout and settings UI edits |
| [specs/03-build-tests-docs.md](./specs/03-build-tests-docs.md) | Machinery deletion, legacy-manifest warning, Dockerfile, tests, harness, README |
| [acceptance-test.md](./acceptance-test.md) | Required evidence per task |
| [operations.md](./operations.md) | Upgrade notes for operators, especially installs that disabled something |
| [handoff.md](./handoff.md) | Copyable assignment for a delegated (LLM) implementer |

## 6. Tasks and dependency order

**Why this order matters:** the `__PB_*` constants exist only while `modules/feature-flags.ts` exists. If you delete the machinery first, every remaining reference becomes a `ReferenceError` at runtime and a type error at build. So **rewrite every consumer first (FF-01 to FF-05)**, then delete the machinery (FF-06). After each task the app must still build and the tests must still pass.

### FF-00: Baseline (no code changes)

- **Depends on:** none. **Size:** XS.
- Record `git rev-parse --short HEAD`, `git status --short`, and Node version in progress.md.
- Run `npm run lint`, `npm run typecheck`, `npm run test:unit` with supported Node 22. Record pass counts and any **existing** failures, so later failures are not wrongly blamed on this work.
- **Done when:** the baseline is recorded in progress.md.

### FF-01: Always render every block type (the user-visible bug)

- **Depends on:** FF-00. **Size:** S. **Spec:** [02 §1](./specs/02-client-recipes.md#1-public-renderer-contentrenderervue).
- Edit `components/content/ContentRenderer.vue` only: remove all `__PB_BLOCK_*` checks, the `disabledBlockTypes` set, the "Disabled content block" branch, its label and its CSS.
- Add the source guard test `tests/unit/feature-flags-retired.test.ts`, starting with the renderer assertions ([spec 03 §5.1](./specs/03-build-tests-docs.md#51-new-test-testsunitfeature-flags-retiredtestts)).
- **Self-check:** `rg -n "__PB_|disabledBlock|disabled-content-block" components/content/ContentRenderer.vue` prints nothing.
- **Done when:** the guard test passes, and lint, typecheck and unit tests pass.

### FF-02: Editor always offers every block

- **Depends on:** FF-01. **Size:** M. **Spec:** [02 §2](./specs/02-client-recipes.md#2-editor).
- Edit `useBlockRegistry.ts`, `BlockEditor.vue`, `BlockToolbar.vue`, `BlockSettings.vue` and `PostSettingsModal.vue`. Delete `DisabledDialogueBlockNodeView.vue` and the i18n key `admin.editor.dialogue.disabled` (both locales).
- Remove the annotation guard in `server/api/admin/annotate.post.ts` ([spec 01 §8](./specs/01-server-recipes.md#8-annotation-endpoint)).
- **Self-check:** `rg -n "__PB_BLOCK_|__PB_MODULE_EDITOR__|isRuntimeEditorBlockEnabled|DisabledDialogue" components composables server pages` prints nothing.
- **Done when:** the editor has no block flags, and lint, typecheck and unit tests pass.

### FF-03: Server features always on

- **Depends on:** FF-02. **Size:** M. **Spec:** [01 §1–§7, §9](./specs/01-server-recipes.md).
- Logs, analytics/GeoIP, MFA, security alerts, backups, multi-user (delete single-user code), post versioning (delete collapse code), schema stripping removal, db-init and restore.
- Update the affected unit tests in the same task ([spec 03 §5.2](./specs/03-build-tests-docs.md#52-update-existing-tests)).
- **Self-check:** `rg -n "__PB_MODULE_|resolveModuleFlags|getRuntimeModuleConfig|accountAllowedInModuleMode|stripModuleSchemaSections|collapsePost" server` prints only the graph/heatmap references that FF-04 removes.
- **Done when:** the server has no module flags except graph/heatmap, and lint, typecheck and unit tests pass.

### FF-04: New public settings for graph view and heatmap

- **Depends on:** FF-03. **Size:** M. **Spec:** [00 §3](./specs/00-target-behavior.md#3-new-public-settings), [01 §10](./specs/01-server-recipes.md#10-graph-and-heatmap-endpoints), [02 §3–§4](./specs/02-client-recipes.md#3-public-pages-graph-and-heatmap).
- Add `graph_view_enabled` and `publish_heatmap_enabled` to the settings contract (server and client), the server helper `server/utils/publicFeatures.ts`, the endpoint guards, the page/component checks, the General settings UI and both locales.
- Add the unit tests in [spec 03 §5.3](./specs/03-build-tests-docs.md#53-new-test-testsunitpublic-features-settingstestts-ff-04).
- **Self-check:** `rg -n "__PB_MODULE_GRAPH_VIEW__|__PB_MODULE_PUBLISH_ACTIVITY_HEATMAP__" .` (excluding `docs/` and `node_modules/`) prints only the machinery files that FF-06 deletes.
- **Done when:** both toggles persist and hide the UI and endpoints, and lint, typecheck and unit tests pass.

### FF-05: Admin UI and client flags

- **Depends on:** FF-04. **Size:** S. **Spec:** [02 §5](./specs/02-client-recipes.md#5-admin-layout-middleware-and-pages).
- Edit `layouts/admin.vue`, `middleware/admin.global.ts`, both dashboard pages, `security.vue`, `login.vue`, both post admin pages and `EditorSidebar.vue`.
- **Self-check:** `rg -n "__PB_|useModuleFlags|moduleFlags|resolveModuleFlags|getRuntimeModuleConfig" pages layouts middleware components composables server utils` prints only `utils/moduleFlags.ts` and `composables/useModuleFlags.ts`.
- **Done when:** no consumer remains, and lint, typecheck and unit tests pass.

### FF-06: Delete the build machinery; add the legacy-manifest warning

- **Depends on:** FF-05. **Size:** S. **Spec:** [03 §1–§4](./specs/03-build-tests-docs.md).
- Delete every file in section 4.1. Edit `package.json`, `.gitignore`, `Dockerfile` and `nuxt.config.ts`.
- Add `build/legacy-module-manifest.ts` (pure helper) and `modules/legacy-module-manifest.ts` (warning only). Add the unit test.
- Remove `access-log-retirement.test.ts` cases that import `build/pandablog-modules.ts` ([spec 03 §5.2](./specs/03-build-tests-docs.md#52-update-existing-tests)).
- **Self-check:** `rg -n "__PB_|pandablog-modules|moduleFlags|useModuleFlags|feature-flags|configure-modules|print-modules|modules:print|public\.modules" --glob '!docs/**' --glob '!node_modules/**' --glob '!.nuxt/**' --glob '!.output/**' .` prints only the new legacy-warning files, their test and the guard test.
- **Done when:** lint, typecheck, unit tests and `npm run build` pass. The build prints no warning without a manifest, and prints the warning with a manifest that contains a `false`.

### FF-07: Harness, docs and combined verification

- **Depends on:** FF-06. **Size:** M (runtime-dependent). **Spec:** [03 §6–§7](./specs/03-build-tests-docs.md).
- Collapse `maintenance-app.ts`/`maintenance-browser.ts` profiles to `full`. Add the deleted paths to `retiredSources`. Extend the emitted-code scan to reject any `__PB_` identifier.
- Update `Readme.md` and add the narrow cross-link notes in `docs/dialogue-block/`.
- Run the [acceptance matrix](./acceptance-test.md). Record exact results in progress.md.
- **Done when:** all local acceptance rows are passed or truthfully recorded as blocked, and progress.md has a resumable handoff.

## 7. Definition of done and commands

Each code task must pass these checks; record the results in progress.md:

```sh
# Supported Node 22 (repository pin 22.22.0). Earlier ledgers used an explicit
# local executable, e.g. C:/Users/huipa/AppData/Local/Temp/pb-node22.exe.
npm run lint
npm run typecheck
npm run test:unit            # if default concurrency hits the known timing flakes, also run: npx vitest run --maxWorkers=4
git diff --check
```

FF-03 and FF-07 also require the guarded real-DB fixture, because schema loading, db-init and restore change:

```sh
node --import tsx scripts/backend-hardening/run.ts --fixture --surreal-bin=/absolute/path/to/surreal-3.2.x
```

FF-07 requires one owned production build and browser profile:

```sh
node --import tsx scripts/backend-hardening/maintenance-app.ts --fixture --profile=full --mode=build --surreal-bin=/absolute/path/to/surreal-3.2.x
```

Known baseline flakes (recorded in earlier ledgers; do not "fix" by weakening assertions): `media-resources.test.ts` 1-second abort deadline under load, Japanese dictionary 5-second initialization, and Windows `EPERM` journal rename.

## 8. Safety rules (read before every task)

- Never use the user's `.env`, `storage/`, configured database, accounts or containers for tests.
- Do not edit `server/utils/schema.surql` (FF-D15).
- Do not add new feature flags, environment variables or settings beyond `graph_view_enabled` and `publish_heatmap_enabled`.
- Do not weaken auth, CSRF, role or privacy checks. Removing single-user mode **removes** a restriction, so it is listed in [operations.md](./operations.md) as an upgrade action for affected operators. It must not change role checks for multi-user installs.
- Do not commit, push or deploy. Preserve unrelated dirty files.
- If a change seems to require a decision that is not in section 2, stop and record the question in progress.md.

## 9. Risks

| Risk | Mitigation |
|---|---|
| A leftover `__PB_*` reference becomes a runtime `ReferenceError` after FF-06 | Guard test plus emitted-code scan in the harness |
| A previously single-user install gets old non-admin accounts back | Operations upgrade step: review and deactivate accounts **before** upgrading |
| A previously MFA-disabled install now challenges enrolled users, or forces admin enrollment if `security_mfa_required_for_admins` was saved as `true` | Operations upgrade step |
| A previously versioning-disabled install starts storing snapshots | Bounded by the existing snapshot limit; documented |
| Schema hash changes and forces a full schema re-apply | Do not edit `schema.surql`. `loadSchema()` returns the raw file, which equals today's all-enabled output |
| The home page is cached for up to ~60 s (`routeRules['/']` SWR), so a toggle change appears with a delay | Documented; acceptable |
| A larger image because the dictionary always ships | ~17 MB; approved (FF-D12) |

Estimate: **1.5–3 engineering days** including verification, depending on fixture availability. The main benefit is lower maintenance: about 1,000+ lines of tooling and ~200 conditional references removed. Do not claim measured performance gains.
