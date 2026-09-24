# AGENTS.md

## Project

**grieg** (`com.enonic.app.grieg`) is an Enonic XP application that orchestrates AI integrations, scheduled jobs and workflows. It exposes an admin tool (`admin/tools/main/`) and four server APIs: `system`, `workflows`, `crons` (admin-only) and `mcp` (public, token-gated). It has no site components.

## Commands

```bash
# Build + deploy to sandbox (watch mode)
./gradlew deploy -t -Penv=dev

# Full build (production by default)
./gradlew build

# Explicit dev build
./gradlew build -Penv=dev

# Vite+ only (faster during development)
pnpm build          # dev build
pnpm build:prod     # production build
pnpm fix            # auto-fix lint issues (Vite+ / Oxlint)
pnpm check          # lint + type-check + tests
pnpm test           # vitest only (via vp test)

# Dev harness: the React app on :5275 against mocked APIs, no XP (see `dev/`)
pnpm dev
```

**Tooling:** `vite-plus` is the single CLI driving lint (Oxlint), build (Rolldown), and test (Vitest) for client assets. Lint, test, and pre-commit (`staged`) are all configured in `vite.config.ts`. Server compilation and type-checking both use `tsc` from `typescript` 7 (the native Go compiler). Note TS 7 removed `baseUrl` and `moduleResolution: node10`, made `bundler` the default resolution (for `CommonJS` too) and interop permanently on, so neither config sets `moduleResolution`, `esModuleInterop` or `allowSyntheticDefaultImports`.

## Architecture

**Build pipeline:** Two parallel pipelines compile TypeScript into `build/resources/main/`:

- **Client-side (Vite):** `src/main/resources/assets/` — React app (`js` target) and Tailwind 4 CSS (`css` target), controlled by `BUILD_TARGET` env var
- **Server-side (`tsc`):** `src/main/resources/**/*.ts` (excluding `assets/`) — per-file CommonJS at ES2025, configured by `src/main/resources/tsconfig.json`. Not bundled: `lib/*.ts` emit as their own modules and relative imports become `require('../../lib/api')`, which XP's `RequireResolver` resolves against the app's resources (it appends `.js` itself). XP imports (`/lib/xp/*`, `/lib/mustache`) are emitted verbatim and resolved at runtime by the bundles `include()`d in `build.gradle.kts`.
  - **ES2025 is safe:** XP 8 leaves GraalJS at its default ECMAScript version (25.x reports 2025) and only pins it to 2020 under the `xp.script-engine.nashorn-compat` system property. ES2026 (`using`, `Array.fromAsync`) is not available.
  - **`lib/` is a shared namespace.** `include()`d XP libs land in the jar at `lib/xp/*` and `lib/mustache.js`, and the app's own `lib/*.ts` emit alongside them. Never name a server lib after an embedded one (e.g. `lib/mustache.ts`) — the outputs would collide in the jar.
  - **Server code must not import npm packages.** There is no bundler in this pipeline, so a bare specifier emits a `require()` XP cannot resolve. `@enonic-types/*` is fine only via `import type`, which is elided.
  - **`delete` is a reserved word.** A DELETE handler is written as a named function and exported with `export { handleDelete as delete }`, which emits `exports.delete`.

**Admin tool entry:**

- `admin/tools/main/main.ts` renders `main.html` (Mustache) with asset URLs and a `#grieg-config` JSON blob (API URIs, user, locale, i18n phrases). The JS bundle (`assets/js/bundle.js`) is a React app that reads it at boot.
- Descriptor uses `admin:extension` API (XP 8 admin framework), not the old `admin:widget`.

**Storage:** workflows live as nodes under `/workflows` in the app's own repository (`com.enonic.app.grieg`), created on startup by `main.ts`. All store access goes through `lib/repo.ts`, which runs in an admin context — callers are already authorized by the time they reach it.

**Scheduling** uses core `lib-scheduler`, not the community `lib-cron`: scheduler jobs are persisted and cluster-aware, so a job fires once per cluster rather than once per node. `apis/crons` currently reads jobs and toggles `enabled`; creating jobs needs a task descriptor, which arrives with the workflow runner.

**MCP endpoint:** `apis/mcp` (mounted on `web`, so served at `/api/com.enonic.app.grieg:mcp`) is a stateless MCP server over HTTP POST. It serves protocol `2026-07-28` and the legacy `initialize` handshake from one method table in `lib/mcp.ts`; the era comes from the `MCP-Protocol-Version` header, then `params._meta`, and a thin wrapper applies what differs (header checks, `resultType`, 404 for unknown methods). Its descriptor allows `role:system.everyone`, so the bearer token from the app config is the only gate — and an unset `mcp.token` disables the endpoint rather than leaving it open. XP replaces 401 bodies with its login page, so rejections are logged. The three content tools (`lib/tools.ts`, with pure shaping in `lib/content-shape.ts`) run as the configured `mcp.user` without a `principals` override, and refuse to run when XP resolves that user to anonymous. `lib/mcp.ts` and `lib/content-shape.ts` stay free of `/lib/xp/*` imports; tests reach `lib/tools.ts` through the `/lib/xp/*` stubs aliased in `vite.config.ts`.

## Configuration

`$XP_HOME/config/com.enonic.app.grieg.cfg`:

```properties
mcp.token = <shared secret clients send as `Authorization: Bearer <token>`>
mcp.project = default
mcp.branch = draft
mcp.user = su
mcp.idProvider = system
mcp.allowedOrigins = <comma-separated browser origins, empty by default>
```

## XP 8 Descriptors

XP 8 replaced XML descriptors with YAML across the board. All descriptors in this project use `.yaml` — **never create `.xml` descriptors**. Every descriptor must declare a `kind:` field. This applies to:

- Application descriptor (`application.yaml`) — requires `kind: "Application"`
- API descriptors (`apis/*/*.yaml`) — require `kind: "API"` and a `title`
- Admin tool descriptors (`admin/tools/main/main.yaml`) — require `kind: "AdminTool"` and `title` (not `displayName`)
- Content types, mixins, x-data, etc.

There is little official documentation on this yet, so don't rely on older XP docs that show XML examples.

## Adding XP Libraries

1. Add to `build.gradle.kts` dependencies: `include("com.enonic.xp:lib-event:${xpVersion}")`
2. Add types: `pnpm add -D @enonic-types/lib-event`
3. Add `/lib/mustache`-style libs to `paths` in `src/main/resources/tsconfig.json`, with a matching `types/*.d.ts` declaration, if not covered by the `/lib/xp/*` wildcard

## Git & GitHub

Conventional commit format throughout. Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`, `ci`.

**`gh` CLI:** Do not assume the `gh` tool is available. If it is missing, the environment is likely a sandbox — do not attempt to install or download it. Use raw `git` commands instead.

### Issue Labels

Each issue gets one **main** label + 0–2 **supportive** labels.

- **Main** (exactly one): `bug`, `feature`, `improvement`, `epic` — or others inferred from context
- **Supportive** (optional):
  - `UI/UX` — changes primarily affecting frontend visuals/interactions (not logic-only or API)
  - `DX` — build, tooling, or developer experience improvements
  - `AI` — code assistant related
  - `wontfix` — closing without changes

### Issues

- **Title**: `<type>: <description>` — e.g. `feat: add workflow runner`
- **Body**: concisely explain what and why, skip trivial details

  ```
  <4–8 sentence description: what, what's affected, how to reproduce, impact>

  ##### Rationale
  <why this needs to be fixed or implemented>

  ##### References        ← optional
  ##### Implementation Notes  ← optional

  <sub>*Drafted with AI assistance*</sub>
  ```

### Commits

- **With issue**: `<Issue Title> #<number>` — e.g. `feat: add workflow runner #12`
- **Without issue**: `<type>: <description>`
- **Body** (optional): past tense, one line per change, 2–6 lines, backticks for code refs
- PRs should contain a single commit on merge; squash locally and force-push before merging unless the PR combines work from several tasks

### Pull Requests

- **Title**: `<type>: <description> #<number>` — use the primary change type (commit format)
- **Body**: concisely explain what and why, skip trivial details. No emojis. Separate all sections with one blank line.

  ```
  <summary of changes>

  Closes #<number>

  [Claude Code session](<link>)

  <sub>*Drafted with AI assistance*</sub>
  ```
