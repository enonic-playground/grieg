# grieg

Enonic XP application (`com.enonic.app.grieg`) that orchestrates AI integrations, scheduled jobs
and workflows. It has an admin tool (`admin/tools/main/`), six server APIs (`system`,
`workflows` and `crons`, all admin-only, `keys` for MCP role members and admins, the public,
token-gated `mcp`, and the public `oauth`), one task (`run-workflow`), and no site components.

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
pnpm build:dev:ui               # MCP card only; :5275/cards.html then hosts it (see Client code)
pnpm build:dev:mcpb             # grieg.mcpb only, the Claude Desktop extension (see Client code)
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
- `pnpm build`, `build:prod` and Gradle's `pnpmBuild` run every `build:dev:*` or `build:prod:*`
  script, in parallel. A new build output gets a script under that pattern, and a helper it calls
  (such as `pack:mcpb`) a name outside it.

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
- `lib/mcp.ts`, `lib/access.ts`, `lib/cards.ts`, `lib/shape.ts`, `lib/content-shape.ts`,
  `lib/node-shape.ts`, `lib/schedule.ts`, `lib/oauth.ts` and `lib/config.ts` stay free of `/lib/xp/*` imports so tests and the dev
  mock can load them directly. Tests reach the other server modules through the `/lib/xp/*`
  stubs aliased in `vite.config.ts`.
  `lib/shape.ts` holds what the content and node tools share (cursors, dot paths, projection),
  and imports nothing, so the shape modules never import each other in a cycle.

## Client code

`src/main/resources/assets/` builds with Vite into the React app (`js` target) and Tailwind 4 CSS
(`css` target), chosen by the `BUILD_TARGET` env var. `admin/tools/main/main.ts` renders
`main.html` with asset URLs and a `#grieg-config` JSON blob (API URIs, user, locale, i18n
phrases), which the React bundle reads at boot.

The `ui` target builds the MCP Apps card from `assets/ui/` into one self-contained file,
`build/resources/main/ui/card.html`, with `vite-plugin-singlefile`. It sits outside `assets/`
so XP never serves it, and `processResources` skips `assets/ui/**`. The card reuses the admin
`Button` and `cn`, and shares the date, duration and user formatting (`js/lib/format.ts`) and
`describeCron` (`js/lib/cron.ts`) with the admin app, so both say a value the same way. Both
draw a run's steps from `runTimeline()` (`js/lib/timeline.ts`). A run records only the steps it
finished, so the waiting ones come from the workflow's current steps, and only while the
workflow is unchanged since the run started; the card gets the workflow from `run_get`. It maps
the admin token names onto the host's MCP Apps style variables in `card.css`, so it follows the
host theme. All values render as React text: no `dangerouslySetInnerHTML`, no images, no
network, and no URL taken from repository data. The only links it opens are the ones the server
builds itself, `adminUrl` and `editUrl`, through `host.openLink`, which drops anything but http(s).

- **ext-apps line:** `@modelcontextprotocol/ext-apps` 2.x with `@modelcontextprotocol/client`
  and `@modelcontextprotocol/core` 2.x (and `zod` 4) as its peers. Do not add
  `@modelcontextprotocol/sdk` 1.x: the lines do not mix. 2.x is the current line and tree-shakes
  to about half the size of 1.x (`App` alone: 230 kB against 427 kB minified).
- **Writes:** the card calls only read tools (`App.callServerTool`). A write is a `ui/message`
  asking Claude, so it runs behind the host's approval prompt; never call a write tool from it.
  The content form (`content_type_get` with a `draft`) puts the reviewed `content_create`
  arguments in the model context (`updateModelContext`) first, and inlines them in the message
  when the host does not take context.
- **Shared rules:** `assets/ui/form.ts` checks a draft with `checkOccurrences` from
  `lib/content-shape.ts`, the same function `content_create` runs, so the card imports a server
  module; keep `lib/content-shape.ts` and `lib/shape.ts` free of server globals for that.
- **Harness:** `pnpm dev` serves `dev/cards.html`, a stand-in host on the official `AppBridge`.
  It loads the built card from `/dev-card/<view>` and answers its `tools/call` from
  `dev/mock-mcp.ts`, which shares the mock API's state. Rebuild with `pnpm build:dev:ui` after a
  change to the card.

The `mcpb` target compiles `dev/mcp-stdio.ts` into one CommonJS file with no dependencies,
`build/mcpb/server/index.js`, next to the manifest from `dev/mcpb/manifest.json` (stamped with
the version from `gradle.properties`) and the icon; `pack:mcpb` then runs `mcpb validate` and
`mcpb pack` into `build/resources/main/assets/grieg.mcpb`, which the MCP tab offers for
download. The bundle carries no key and no URL: Desktop asks for both on install and keeps the
key in its encrypted settings. Keep the forwarder free of Node-24-only APIs, since Desktop's
bundled Node version is not documented. The manifest's `tools` list is checked against the
server's tools in `src/test/apis/mcp.test.ts`, so a new tool goes into both.

## Architecture

- **Storage.** Workflows are nodes under `/workflows` in the app's own repository
  (`com.enonic.app.grieg`), created on startup by `main.ts`. All store access goes through
  `lib/repo.ts`, which runs in an admin context: callers are authorized before they reach it.
  `/workflows` carries `ADMIN_ONLY` and its children inherit it, so the MCP node tools cannot
  read the store as a non-admin user; `initWorkflows()` re-applies it on startup.
- **MCP keys** live under `/mcp/keys` in the same repository (`lib/keys.ts`); OAuth grants live
  apart under `/mcp/oauth` (see OAuth grants), so a key rotation never touches them. `/mcp` and
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
  `runInRepo`, and stores only messages from `renderPrompt()` and `generate()`. `startRun()`
  (`lib/run-start.ts`, behind the API's `POST ?action=run` and `workflow_run`) creates the run
  node, submits the task with `{ workflowId, runId }` outside `runInRepo`, so the task inherits
  the caller and not the store's admin, and stamps the run with the task id; a task without `runId` (a schedule) creates its own. Task
  config is not validated against the form, so the task adopts a `runId` only when it names a
  `running` run of that workflow that no other task has claimed. A `running` run counts as going
  only while lib-task reports its task live (or, unstamped, for its first minute); the skip guard
  and the startup `sweepInterrupted()` fail the rest as `interrupted`, so a restart on one
  cluster node leaves another node's runs alone. `getById()` accepts only direct children of
  `/workflows`, since run nodes live below it.
- **Scheduling** uses core `lib-scheduler`, not the community `lib-cron`, because scheduler jobs
  are persisted and fire once per cluster. A workflow has at most one cron job, named
  `grieg-workflow-<workflowId>` (`scheduleName()` in `lib/schedule.ts`), running `RUN_TASK` with
  config `{ workflowId }`. `lib/crons.ts` holds the scheduler logic that `apis/crons` and the
  MCP cron tools share, returning `{ code, message }` failures each maps to its own errors. It
  creates, edits and deletes only jobs with that descriptor, and sets the job `user` to the caller on every save; another app's job only
  toggles `enabled` and keeps its user, so a save never makes it run as the saving admin. The
  scheduler re-authenticates the job user at fire time, so a disabled or demoted owner turns
  every scheduled run into a `failed` one. The job's `enabled` is the only switch: the task
  ignores the workflow's own `enabled`, which nothing in the UI sets and `createWorkflow`
  defaults to `false`. lib-scheduler falls back to GMT for an unknown time zone, so
  `lib/time-zone.ts` checks it through the JVM first. Deleting a workflow deletes its job, best
  effort.
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
  - The content tools default to `mcp.project`. A `project` argument is first checked with
    lib-project `get()` as the acting user, which throws for a project the user holds no role
    in. `content_localize` has no XP call of its own: lib-content `update()` drops the `CONTENT`
    and `NAME` inherit flags whenever it changes something, which is Content Studio's "Localize"
    too, so a no-op call would leave the item inherited and is refused. It writes to draft only.
    lib-content `resetInheritance()` checks no caller access, so it is never exposed.
  - The workflow tools (`lib/workflow-tools.ts`) share `lib/crons.ts` and `lib/run-start.ts`
    with `apis/crons` and `apis/workflows`, so REST and MCP follow one set of rules. They are
    admin-only. `ToolsConfig.admin` comes from
    the key resolution, or for the shared token from the injected `isAdmin` resolver;
    `apis/mcp` moves the toolset into `disabledTools` for anyone else, and every handler checks
    `hasRole('system.admin')` again as the acting user before touching the store or scheduler.
  - lib-repo `list()` is admin-only, so `node_repos` lists as admin and keeps only branches
    where a `count: 0` query as the user finds a node. Content repositories keep project roles
    off the root node, and `exists()` runs as admin, so neither proves access.
  - Every write tool calls `auditWrite()` (`lib/audit.ts`) only after the write lands, inside
    the acting user's context. A failed audit write is logged, never returned as a tool error.
  - **Cards** (MCP Apps): `lib/cards.ts` maps `workflow_list`, `run_*`, `cron_list`,
    `node_query`/`node_get`/`node_repos` and `content_search`/`content_get`/`content_type_get`
    to five `ui://grieg/*` views of one HTML file, each stamped with `<html data-view>`. The card
    tells results apart by shape (`inferTool` in `assets/ui/shapes.ts`), so a new card tool
    needs a key no other result carries. A `content_type_get` result with `draft` renders as
    an editable form rather than the field list. `apis/mcp/mcp.ts` reads `ui/card.html` through lib-io
    once per app start; without it, it logs once and serves no resources or tool `_meta.ui`.
    `resources/*` and the `resources` capability exist only while there are resources.
    `describeTools` names a tool's view three ways: `_meta.ui.resourceUri`, the flat
    `ui/resourceUri`, and ChatGPT's `openai/outputTemplate`.
  - `ToolAnnotations` requires `readOnlyHint`, `destructiveHint` and `openWorldHint`, which
    ChatGPT lists as required; it treats a tool without `readOnlyHint` as a write.
  - **OAuth discovery** (`apis/oauth`): `deny()` adds `resource_metadata` to the 401 challenge,
    and the API's `well-known` GET serves RFC 9728 and RFC 8414 metadata, which the root
    `/.well-known` reaches only through a vhost mapping. `lib/oauth.ts` builds every URL from the
    request origin (`originOf`) and the fixed `/api/<app>:mcp` and `/api/<app>:oauth` paths.
    `ENDPOINTS` lists what the API serves, and nothing is published (challenge, either document,
    either endpoint) until `oauth.enabled` is on and it holds `authorize` and `token`: the MCP
    spec requires the resource metadata to name an authorization server, and none may be
    advertised before it works. Add `register` to `ENDPOINTS` only with its handler.
  - **OAuth grants**: `apis/oauth` routes `authorize` (GET consent page, POST decision) and `token`
    on `req.path`; form bodies arrive in `req.params`. `lib/oauth.ts` holds the pure protocol
    (request validation, PKCE, the `iss`-carrying redirect, `matchRefresh`), `lib/grants.ts` the
    store under `/mcp/oauth/{grants,codes,access}`, all `ADMIN_ONLY` and digest-named except
    grants, which take a random hex id that the refresh token (`<grantId>.<secret>`) carries.
    `lib/keys.ts` `authenticate()` falls through to `resolveAccess()` on a personal-key miss and
    runs the same `checkOwner()`, which grants also get injected; `lib/grants.ts` never imports
    `lib/keys.ts`. `/authorize` gets XP's login only by returning 401 from the controller (a
    descriptor `allow` gives a bare 401), so the API stays public and the handler checks the
    session user and `hasRole(MCP_ROLE_NAME)` itself; `/token` must stay on a vhost mapping
    with no ID provider, or its errors become the login page. The consent POST is refused unless
    `Origin` (or `Sec-Fetch-Site`) is same-origin, and re-validates every posted parameter.
    lib-node has no lock or version check, so each consume (code claim, refresh rotation) writes
    and then reads the node again; that catches most lost races but not two reads that both come
    before either write. When two refreshes race that way, both succeed, and the next use of the
    losing refresh token counts as reuse and revokes the grant. Keep one writer per node where
    possible: `lastUsed` is recorded on the access node, because a write to the grant from an MCP
    request could undo a rotation. A client_id is an unverified label until client registration
    lands; the exact `oauth.redirectUris` match admits a client. Never
    log a code, a token, a verifier or a digest; the grant id is half a refresh token, so it stays
    out of logs too. The consent page renders through `/lib/mustache`, which tests alias to
    `src/test/stubs/mustache.ts`.
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
   in `vite.config.ts` and a stub, as `/lib/http-client` and `/lib/mustache` have.

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
- **Issue type**: every issue gets a GitHub issue type, `Feature`, `Bug` or `Task` (epics take
  `Feature`): `gh issue create --type <Type>`, or `gh issue edit` / the API on an existing one.
- **PR title**: `<type>: <description> #<number>`, matching the commit.
- **PR body**: a summary of the changes, then one `Closes #<number>` per line, with one blank
  line between sections. No emojis, generated-by footer, `---` rule, session link or `<sub>`
  attribution.
- A PR merges as a single commit. Squash locally and force-push first, unless the PR combines
  work from several tasks.
- Do not assume `gh` is installed. Where it is missing, use plain `git` and do not install it.
