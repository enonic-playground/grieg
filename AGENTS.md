# grieg

Enonic XP application (`com.enonic.app.grieg`) that orchestrates AI integrations, scheduled jobs
and workflows. It has an admin tool (`admin/tools/main/`), four server APIs (`system`,
`workflows` and `crons`, all admin-only, plus the public, token-gated `mcp`), and no site
components.

This is the only agent instruction file. Do not add a `CLAUDE.md`: Claude Code reads `AGENTS.md`
only when no `CLAUDE.md` exists, so adding one would hide everything here.

## Commands

```bash
./gradlew deploy -t -Penv=dev   # Build + deploy to the sandbox, watch mode
./gradlew build                 # Full build, production by default (-Penv=dev for dev)
pnpm build                      # Vite+ only, dev build (build:prod for production)
pnpm check                      # Lint + type-check + tests
pnpm fix                        # Format + auto-fix lint
pnpm test                       # Vitest only
pnpm dev                        # React app on :5275 against mocked APIs, no XP (see dev/)
pnpm conformance                # MCP conformance suite against a running XP (manual)
```

- `vite-plus` (`vp`) drives lint (Oxlint), build (Rolldown) and tests (Vitest) for client
  assets. Lint, tests and the pre-commit `staged` hook are all configured in `vite.config.ts`.
- Server compilation and every type-check use `tsc` from TypeScript 7. TS 7 removed `baseUrl`
  and `moduleResolution: node10`, defaults to `bundler` resolution and has interop always on, so
  no tsconfig sets `moduleResolution`, `esModuleInterop` or `allowSyntheticDefaultImports`.
- `pnpm conformance` needs `GRIEG_MCP_TOKEN` and gates on `dev/conformance-allowlist.json`.
  README → Conformance covers `--update` and the vhost caveat.

## Server code

`src/main/resources/**/*.ts`, excluding `assets/`, compiles per file to CommonJS at ES2025 with
`src/main/resources/tsconfig.json`. There is no bundler.

- Relative imports emit as `require('../../lib/api')`, which XP's `RequireResolver` resolves
  against the app's resources. XP imports (`/lib/xp/*`, `/lib/mustache`) are emitted verbatim
  and resolved by the libs `include()`d in `build.gradle.kts`.
- Never import an npm package. A bare specifier emits a `require()` XP cannot resolve.
  `@enonic-types/*` is fine only through `import type`, which is elided.
- ES2025 is the ceiling: XP 8 runs GraalJS at its default ECMAScript version, so ES2026
  (`using`, `Array.fromAsync`) is unavailable. Nor are web globals such as `URL` or `atob`.
- `lib/` shares the jar namespace with the embedded libs (`lib/xp/*`, `lib/mustache.js`). Never
  name a server lib after one of them.
- `delete` is a reserved word: write a DELETE handler as a named function and export it with
  `export { handleDelete as delete }`.
- `lib/mcp.ts`, `lib/access.ts`, `lib/content-shape.ts` and `lib/config.ts` stay free of
  `/lib/xp/*` imports so tests can load them directly. Tests reach the other server modules
  through the `/lib/xp/*` stubs aliased in `vite.config.ts`.

## Client code

`src/main/resources/assets/` builds with Vite into the React app (`js` target) and Tailwind 4 CSS
(`css` target), chosen by the `BUILD_TARGET` env var. `admin/tools/main/main.ts` renders
`main.html` with asset URLs and a `#grieg-config` JSON blob (API URIs, user, locale, i18n
phrases), which the React bundle reads at boot.

## Architecture

- **Storage.** Workflows are nodes under `/workflows` in the app's own repository
  (`com.enonic.app.grieg`), created on startup by `main.ts`. All store access goes through
  `lib/repo.ts`, which runs in an admin context: callers are authorized before they reach it.
- **Scheduling** uses core `lib-scheduler`, not the community `lib-cron`, because scheduler jobs
  are persisted and fire once per cluster. `apis/crons` only reads jobs and toggles `enabled`.
  Creating jobs needs a task descriptor, which arrives with the workflow runner.
- **MCP** (`apis/mcp`, served at `/api/com.enonic.app.grieg:mcp`) is a stateless MCP server over
  HTTP POST.
  - `lib/mcp.ts` serves protocol `2026-07-28` and the legacy `initialize` handshake from one
    method table. The era comes from the `MCP-Protocol-Version` header, then `params._meta`.
  - The descriptor allows `role:system.everyone`, so `lib/access.ts` is the whole gate, checked
    in this order: refuse any cookie, check `Origin` against `Host`, refuse while `mcp.token` or
    `mcp.user` is unset, then match the bearer token.
  - Same-origin compares scheme, host and port as XP resolves them, `X-Forwarded-*` included,
    and the host must also be trusted. Same-origin alone does not stop DNS rebinding.
  - XP replaces 401 bodies and anonymous 403s with its login page, so the log is the only
    place a rejection reason appears. Never log a cookie value or a token.
  - The content tools (`lib/tools.ts`) run as `mcp.user` without a `principals` override, and
    refuse to run when XP silently resolves that user to anonymous.

App config keys, their defaults and their behavior are documented once, in README →
Configuration. Change that block whenever a key changes.

## XP 8 descriptors

XP 8 replaced XML descriptors with YAML. Older XP docs show XML; ignore them.

- Never create an `.xml` descriptor.
- Every descriptor declares `kind:`: `Application` for `application.yaml`, `API` plus a `title`
  for `apis/*/*.yaml`, and `AdminTool` plus `title` (not `displayName`) for
  `admin/tools/main/main.yaml`.
- Admin tools use the XP 8 `admin:extension` API, not `admin:widget`.

## Adding an XP library

1. Add it to `build.gradle.kts`: `include("com.enonic.xp:lib-event:${xpVersion}")`.
2. Add its types: `pnpm add -D @enonic-types/lib-event`.
3. If the `/lib/xp/*` wildcard does not cover it, add a `paths` entry in
   `src/main/resources/tsconfig.json` and a matching `types/*.d.ts`, as for `/lib/mustache`.

## Git & GitHub

Conventional Commits. Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`, `ci`.

- **Commit**: `<issue title> #<number>`, or `<type>: <description>` without an issue. Body
  optional: past tense, one line per change, backticks for code refs.
- **Issue title**: `<type>: <description>`.
- **Issue body**: what and why in 4–8 sentences, then a `##### Rationale` section. Add
  `##### References` and `##### Implementation Notes` only when they carry something.
- **Issue labels**: exactly one main label (`bug`, `feature`, `improvement`, `epic`) plus up to
  two supportive ones: `UI/UX` (mainly frontend visuals or interaction), `DX` (build or
  tooling), `AI` (code assistants), `wontfix` (closed without changes).
- **PR title**: `<type>: <description> #<number>`, matching the commit.
- **PR body**: a summary of the changes, then one `Closes #<number>` per line, with one blank
  line between sections. No emojis, generated-by footer, `---` rule, session link or `<sub>`
  attribution.
- A PR merges as a single commit. Squash locally and force-push first, unless the PR combines
  work from several tasks.
- Do not assume `gh` is installed. Where it is missing, use plain `git` and do not install it.
