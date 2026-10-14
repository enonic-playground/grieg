# grieg

Enonic XP application (`com.enonic.app.grieg`) that orchestrates AI integrations, scheduled jobs
and workflows. It has an admin tool (`admin/tools/main/`), five server APIs (`system`,
`workflows` and `crons`, all admin-only, `keys` for MCP role members and admins, plus the public,
token-gated `mcp`), one task (`run-workflow`), and no site components.

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
node dev/mcp-stdio.ts           # stdio→HTTP MCP forwarder for stdio-only clients (README → MCP)
```

- `vite-plus` (`vp`) drives lint (Oxlint), build (Rolldown) and tests (Vitest) for client
  assets. Lint, tests and the pre-commit `staged` hook are all configured in `vite.config.ts`.
- Server compilation and every type-check use `tsc` from TypeScript 7. TS 7 removed `baseUrl`
  and `moduleResolution: node10`, defaults to `bundler` resolution and has interop always on, so
  no tsconfig sets `moduleResolution`, `esModuleInterop` or `allowSyntheticDefaultImports`.
- `pnpm conformance` needs `GRIEG_MCP_TOKEN` and gates on `dev/conformance-allowlist.json`.
  README → Conformance covers `--update` and the vhost caveat.
- `dev/mcp-stdio.ts` keeps its header, era and error logic in `dev/mcp-stdio-protocol.ts`, which
  `src/test/dev/` runs against `lib/mcp.ts` `handle()`. Change both when the header rules change.

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
- `lib/mcp.ts`, `lib/access.ts`, `lib/shape.ts`, `lib/content-shape.ts`, `lib/node-shape.ts`
  and `lib/config.ts` stay free of `/lib/xp/*` imports so tests can load them directly. Tests
  reach the other server modules through the `/lib/xp/*` stubs aliased in `vite.config.ts`.
  `lib/shape.ts` holds what the content and node tools share (cursors, dot paths, projection),
  and imports nothing, so the shape modules never import each other in a cycle.

## Client code

`src/main/resources/assets/` builds with Vite into the React app (`js` target) and Tailwind 4 CSS
(`css` target), chosen by the `BUILD_TARGET` env var. `admin/tools/main/main.ts` renders
`main.html` with asset URLs and a `#grieg-config` JSON blob (API URIs, user, locale, i18n
phrases), which the React bundle reads at boot.

## Architecture

- **Storage.** Workflows are nodes under `/workflows` in the app's own repository
  (`com.enonic.app.grieg`), created on startup by `main.ts`. All store access goes through
  `lib/repo.ts`, which runs in an admin context: callers are authorized before they reach it.
  `/workflows` carries `ADMIN_ONLY` and its children inherit it, so the MCP node tools cannot
  read the store as a non-admin user; `initWorkflows()` re-applies it on startup.
- **MCP keys** live under `/mcp/keys` in the same repository (`lib/keys.ts`). `/mcp` and
  `/mcp/keys` carry an admin-only ACL (`ADMIN_ONLY` in `lib/repo.ts`), because the node tools
  can reach this repository as a non-admin user. A key node is named by the SHA-256 hex digest
  of the key, so a lookup is a `get` by path; the plaintext is returned once and never stored.
  One key per owner, 90 days, immutable except a best-effort hourly `lastUsed`. `main.ts`
  bootstraps `role:com.enonic.app.grieg.mcp`, the role that entitles a user to hold a key.
  `lib/key-crypto.ts` wraps the JVM crypto behind `Java.type`, and tests mock it.
- **Keys API** (`apis/keys`) acts on the caller's own key, the owner taken from `getUser()` and
  never from the request, and refuses callers without the MCP role, admins included. Only
  `GET ?all=true` and `DELETE ?owner=` are admin paths. `POST` returns the plaintext once.
- **Vertex AI.** `lib/vertex.ts` `generate({ prompt, model?, runId? })` calls Gemini through
  lib-http-client and throws only short messages that are safe to store. `lib/vertex-auth.ts`
  reaches google-auth-library through `Java.type`, holds one cached credentials object, and is
  mocked in tests. Never log or throw a prompt, an output, a token or a response body.
- **Runs.** The task `com.enonic.app.grieg:run-workflow` (`tasks/run-workflow/`) runs a
  workflow's `llm` steps through `generate()` and records each run as a child node,
  `/workflows/<name>/runs/<id>`, through `lib/runs.ts`; `lib/steps.ts` validates steps and fills
  `{{steps.<id>.output}}` placeholders, and stays free of `/lib/xp/*` imports. The task checks
  `role:system.admin` on its inherited context as its first statement, before anything reaches
  `runInRepo`, and stores only messages from `renderPrompt()` and `generate()`. The API's
  `POST ?action=run` creates the run node, submits the task with `{ workflowId, runId }` and
  stamps the run with the task id; a task without `runId` (a schedule) creates its own. Task
  config is not validated against the form, so the task adopts a `runId` only when it names a
  `running` run of that workflow that no other task has claimed. A `running` run counts as going
  only while lib-task reports its task live (or, unstamped, for its first minute); the skip guard
  and the startup `sweepInterrupted()` fail the rest as `interrupted`, so a restart on one
  cluster node leaves another node's runs alone. `getById()` accepts only direct children of
  `/workflows`, since run nodes live below it.
- **Scheduling** uses core `lib-scheduler`, not the community `lib-cron`, because scheduler jobs
  are persisted and fire once per cluster. `apis/crons` only reads jobs and toggles `enabled`.
  Creating jobs needs a task descriptor, which arrives with the workflow runner.
- **MCP** (`apis/mcp`, served at `/api/com.enonic.app.grieg:mcp`) is a stateless MCP server over
  HTTP POST.
  - `lib/mcp.ts` serves protocol `2026-07-28` and the legacy `initialize` handshake from one
    method table. The era comes from the `MCP-Protocol-Version` header, then `params._meta`.
  - The descriptor allows `role:system.everyone`, so `lib/access.ts` is the whole gate, checked
    in this order: refuse any cookie, check `Origin` against `Host`, require a bearer, then
    admit a `grieg_` bearer only through the injected key resolver (never the shared token),
    and any other bearer only when it matches `mcp.token` while `mcp.token` and `mcp.user` are
    both set (deprecated shared-token mode).
  - The resolver is `authenticate()` in `lib/keys.ts`: the key must exist and be unexpired, and
    its owner must exist, be enabled and hold `role:com.enonic.app.grieg.mcp` at request time
    (`getMemberships(owner, true)` as admin).
  - Same-origin compares scheme, host and port as XP resolves them, `X-Forwarded-*` included,
    and the host must also be trusted. Same-origin alone does not stop DNS rebinding.
  - XP replaces 401 bodies and anonymous 403s with its login page, so the log is the only
    place a rejection reason appears. Never log a cookie value, a token, a key or its digest.
  - The content tools (`lib/tools.ts`) and node tools (`lib/node-tools.ts`) run as the acting
    user, the key's owner or `mcp.user` (`ToolsConfig.user`, `idProvider`, `credential`),
    through `lib/run-as.ts`, without a `principals` override, and refuse to run when XP
    silently resolves that user to anonymous.
  - lib-repo `list()` is admin-only, so `node_repos` lists as admin and keeps only branches
    where a `count: 0` query as the user finds a node. Content repositories keep project roles
    off the root node, and `exists()` runs as admin, so neither proves access.
  - Every write tool calls `auditWrite()` (`lib/audit.ts`) only after the write lands, inside
    the acting user's context. A failed audit write is logged, never returned as a tool error.
  - `node_create` must pass `_inheritsPermissions: true`: without it lib-node grants admins
    everything and `role:system.everyone` READ.

App config keys, their defaults and their behavior are documented once, in README →
Configuration. Change that block whenever a key changes.

## XP 8 descriptors

XP 8 replaced XML descriptors with YAML. Older XP docs show XML; ignore them.

- Never create an `.xml` descriptor.
- Every descriptor declares `kind:`: `Application` for `application.yaml`, `API` plus a `title`
  for `apis/*/*.yaml`, and `AdminTool` plus `title` (not `displayName`) for
  `admin/tools/main/main.yaml`.
- Admin tools use the XP 8 `admin:extension` API, not `admin:widget`.
- The admin tool admits `role:com.enonic.app.grieg.mcp` as well as admins, so every API it lists
  must declare its own `allow` and check access in its handlers. `src/test/apis/descriptors.test.ts`
  fails on an API descriptor without one.

## Adding an XP library

1. Add it to `build.gradle.kts`: `include("com.enonic.xp:lib-event:${xpVersion}")`.
2. Add its types: `pnpm add -D @enonic-types/lib-event`.
3. If the `/lib/xp/*` wildcard does not cover it, add a `paths` entry in
   `src/main/resources/tsconfig.json` and a matching `types/*.d.ts`, as for `/lib/mustache`.
   A types package that declares its module as an augmentation, as `/lib/http-client` does,
   also goes in `types`, and its `types/*.d.ts` is an empty module for it to augment.
4. Tests alias only `/lib/xp/*` to `src/test/stubs/xp/`; any other path needs its own alias
   in `vite.config.ts` and a stub, as `/lib/http-client` has.

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
