# grieg

Enonic XP application that orchestrates AI integrations, scheduled jobs and workflows.

## Surfaces

| Surface       | Path                                  | Access                                                         |
| ------------- | ------------------------------------- | -------------------------------------------------------------- |
| Admin tool    | `admin/tools/main`                    | `role:system.admin`, `role:com.enonic.app.grieg.mcp`           |
| System API    | `/api/com.enonic.app.grieg:system`    | `role:system.admin`                                            |
| Workflows API | `/api/com.enonic.app.grieg:workflows` | `role:system.admin`                                            |
| Crons API     | `/api/com.enonic.app.grieg:crons`     | `role:system.admin`                                            |
| Keys API      | `/api/com.enonic.app.grieg:keys`      | `role:com.enonic.app.grieg.mcp`; all keys: `role:system.admin` |
| MCP API       | `/api/com.enonic.app.grieg:mcp`       | public, bearer key                                             |

Admins and members of `role:com.enonic.app.grieg.mcp` can open the admin tool. The Keys API it lists serves members their own MCP key; the System, Workflows and Crons APIs behind it answer admins only.

## Development

```bash
pnpm install
pnpm dev            # React app on :5275 against mocked APIs, no XP needed
pnpm build:dev:ui   # the MCP card; then open :5275/cards.html, a stand-in host for it
pnpm check          # lint + type-check + tests
./gradlew build     # full app jar
./gradlew deploy -t -Penv=dev   # build + deploy to the running sandbox, in watch mode
```

## Configuration

Create `$XP_HOME/config/com.enonic.app.grieg.cfg`:

```properties
# Content context the MCP tools operate in. `mcp.project` is the default: content_search,
# content_get and content_update also take a `project` the acting user holds a role in. With
# `mcp.branch = master`, edits made with a personal key go live at once under the key owner's name.
mcp.project = default
mcp.branch = draft

# Deprecated shared-token mode, off unless both `mcp.token` and `mcp.user` are set. A bearer
# equal to `mcp.token` then runs the tools as `mcp.user` in the `mcp.idProvider` ID provider,
# and the first such request after each config change logs a deprecation warning. Personal
# keys work whether or not these are set. A missing or disabled `mcp.user` makes every tool
# call fail rather than run anonymously. `mcp.token` must not start with `grieg_`: such a
# bearer is only ever looked up as a personal key.
mcp.token =
mcp.user =
mcp.idProvider = system

# Browser origins allowed to call the endpoint, comma-separated. Empty by default. CLI
# clients such as Claude Code send no `Origin` and are not affected.
mcp.allowedOrigins =

# Hostnames, without port, that a same-origin browser request may target, comma-separated.
# `localhost`, `127.0.0.1` and `[::1]` are always trusted.
mcp.allowedHosts =

# Toolsets to serve, comma-separated: `content` (content_*), `nodes` (node_*) and `workflows`
# (workflow_*, run_*, cron_*; served only to administrators). Unknown names are ignored with a
# log warning; a blank value serves no tools at all. An install that sets this key must list
# `workflows` to get the workflow tools.
mcp.toolsets = content,nodes,workflows

# `true` removes content_update, content_create, content_localize, node_create, node_update,
# workflow_run, cron_set and cron_delete from `tools/list`, and refuses them if called anyway.
mcp.readOnly = false

# Repositories the node tools may use, comma-separated exact ids. Empty means every
# repository except `system-repo` and `system.*`, which are always denied.
mcp.nodes.repos =

# Vertex AI (Gemini) for workflow steps, called on the `eu` multi-region endpoint
# (`aiplatform.eu.rep.googleapis.com`), which keeps requests inside the EU. A 404 reported as
# "not routed" never reached the Vertex API: check that the project can use that endpoint and
# that the model is served on `v1`.
#
# With `vertex.credentialsPath` unset, grieg uses Application Default Credentials
# (`GOOGLE_APPLICATION_CREDENTIALS`, gcloud's ADC file, or the metadata server on Google Cloud).
# Set it to the path of a credentials JSON file on the XP host to use that instead; a replaced
# file is picked up on the next call. Only the path goes here, never the key itself.
vertex.credentialsPath =
# Google Cloud project to bill. Unset falls back to the credentials' project, then the
# `GOOGLE_CLOUD_PROJECT` environment variable; with none of the three, every call fails.
vertex.project =
# Model for steps that do not name one.
vertex.model = gemini-3.1-flash-lite
```

> [!IMPORTANT]
> `mcp.token` and `mcp.user` are deprecated. Give each user a personal key (see [MCP](#mcp)), then unset both. An install that keeps them set keeps working as before.

A request that carries an `Origin` header is accepted only when that origin is listed in `mcp.allowedOrigins`, or when it is same-origin with the request (scheme, host and port, as XP resolves them with `X-Forwarded-*` headers) on a trusted host. Same-origin alone is not enough, since in a DNS-rebinding attack both headers name the attacker's host. A request that carries any cookie is refused outright: MCP clients send none, and XP would otherwise admit a logged-in admin's browser session.

XP picks up changes to this file without a restart.

## Workflows

A workflow is a list of `llm` steps, `{ id, type: 'llm', config: { prompt, model? } }`, run in order on Vertex AI. A prompt can use an earlier step's output through `{{steps.<id>.output}}`, replaced as plain text; the last step's output is the run's output. Creating or updating a workflow through the Workflows API refuses steps of another type, without a prompt, with a repeated id, or referencing a step that is not earlier, with a `400 INVALID_STEPS` that names the step.

`POST ?id=<id>&action=run` starts a run as the calling admin and returns `{ runId, taskId, status }` once the run record exists; `GET ?id=<id>&runs=true` lists the workflow's runs, newest first. A run records `status` (`running`, `done`, `failed` or `skipped`), `trigger` (`manual` or `schedule`), `user`, `taskId`, `startedAt`, `finishedAt`, each step's `output`, `error` and `ms`, and the run's `output` and `error`. Runs only run as an administrator: a run whose user is not one, or resolves to anonymous, is recorded as `failed`. Starting a run while another run of the same workflow is going records it as `skipped`; the check is not atomic, so two runs started in the same instant can both go ahead. Outputs are stored up to 32 KB, and the last 20 runs of each workflow are kept. A run that no live task owns any more, such as one left `running` by a restart, is marked `failed` with the error `interrupted`, at startup or when the next run of that workflow starts. Runs are stored under the workflow, so deleting the workflow deletes them, and only administrators can read them. The log carries a run's status, latency and id, never a prompt or an output.

In the admin tool's Workflows tab an admin creates a workflow by name, then on its page edits the steps (add, remove, reorder, a prompt and an optional model each), runs it, and reads its runs: status, trigger, user, timing, each step's output or error, and the run's output. The runs list refreshes every two seconds while a run is going. Run now runs the saved steps, so it waits until edited steps are saved, and leaving the page with unsaved steps or an unsaved schedule asks first. `pnpm dev` serves the same flow against an in-memory mock, where each step takes 1.5 s and a prompt containing the word "fail" fails its step.

### Schedules

A workflow runs on a cron through one XP scheduler job, named `grieg-workflow-<workflowId>`, which runs the `run-workflow` task once per cluster as the job's user. The Crons API manages it:

- `POST` with `{ workflowId, cron, timeZone?, enabled? }` creates it, in `UTC` and enabled unless the body says otherwise, and answers `409` when the workflow already has one.
- `PUT ?name=<job>` with any of `{ cron, timeZone, enabled }` changes it.
- `DELETE ?name=<job>` deletes it; deleting the workflow deletes it too.
- `GET ?workflowId=<id>` returns it, or `null`. `GET` lists every job on the server, with the user it runs as and, for a workflow schedule, its `workflowId`.

The job runs as the admin who last saved it: every `POST` and `PUT` sets its user to the caller, whatever the body says. If that admin is later disabled or loses `role:system.admin`, each scheduled run is recorded as `failed`; another admin re-saving the schedule takes it over. The cron has five fields (minute, hour, day of month, month, day of week), and an unknown time zone is refused with `400 INVALID_TIME_ZONE` rather than run in GMT. A fire that lands while a run is going is recorded as `skipped`. The job's `enabled` is the only switch: the workflow's own `enabled` flag does not stop a schedule. Jobs of other applications are listed too, but only their `enabled` can be toggled here, which leaves their user as it is; their cron cannot be changed, and they cannot be deleted.

On a workflow's page the Schedule card edits the cron, time zone and enabled state, shows who the job runs as and when it last ran, and deletes it. The Crons tab lists every job with the user it runs as, and links a workflow schedule to its workflow.

## MCP

The endpoint is `http://<host>:8080/api/com.enonic.app.grieg:mcp`, a stateless MCP server over HTTP POST. It speaks protocol `2026-07-28` (`server/discover` plus per-request `_meta`) and the legacy `initialize` handshake (`2025-11-25`, `2025-06-18`, `2025-03-26`) from the same URL.

| Tool               | Does                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `content_search`   | Full-text search by `text`, or list the children of `path`; compact summaries and a cursor     |
| `content_get`      | One item by id or path: owner, dates, `data` (default), `x`, `page`, `attachments`, `fields`   |
| `content_type_get` | A content type's fields as dot paths, with input type, occurrences and config, depth-capped    |
| `content_update`   | Change `displayName`, `language` or top-level scalar `data` fields, with conflict checking     |
| `content_create`   | Create an item on draft, in progress, validated against its content type                       |
| `project_list`     | The content projects the acting user can read, with language and parent projects               |
| `content_localize` | Write a translation of an inherited item into a layer, on draft, which localizes it            |
| `node_repos`       | Repositories and branches the acting user can read, with whether the node tools may write them |
| `node_query`       | lib-node query (DSL or NoQL) with filters, sort, capped aggregations, `fields` and a cursor    |
| `node_get`         | One node by id or path, with `data` (default), `permissions`, `indexConfig` or `fields`        |
| `node_create`      | Create a node under a parent; permissions are inherited and cannot be set                      |
| `node_update`      | `set` and `unset` dot paths on a node, with `expectedVersionKey` conflict checking             |
| `workflow_list`    | Every workflow with its step count, schedule and last run, and a link to it in the admin tool  |
| `workflow_run`     | Start a run as the acting user; returns its `runId` at once                                    |
| `run_list`         | A workflow's runs, newest first, without outputs                                               |
| `run_get`          | One run with each step's output or error and duration; outputs cut to 4,000 characters         |
| `cron_list`        | Every scheduled job on the server, workflow schedules first                                    |
| `cron_set`         | Create or change a workflow schedule, or toggle another application's job                      |
| `cron_delete`      | Delete a workflow schedule                                                                     |

`node_update` keeps a property's type: a `set` on a date, time, geo point or reference takes the string `node_get` shows for it and stores it as that type again. A `set` over a link, a binary reference or a property holding several typed values is refused, since a string would replace its type. Xml properties read as plain strings, so a `set` on one stores a String.

The node tools run as the acting user too, so XP's node permissions decide what they can read and write. `system-repo` and `system.*` repositories are never available. `com.enonic.cms.*` repositories are read-only through `node_*`, since a lib-node write would bypass content validation, the workflow reset and project roles; content writes go through `content_update`. Branches default to `draft` for content repositories and `master` elsewhere. `expectedVersionKey` is checked inside lib-node's update editor, which has no lock: it catches a write that landed since your read, but not one landing during the update itself.

Layers are how XP holds translations: a project with a parent inherits the parent's content, and an item edited in the layer turns from inherited to localized, after which edits in the parent no longer reach it. Every content summary carries its `project` and an `inheritance` of `inherited`, `localized` or `null` (created in that project). `content_search`, `content_get` and `content_update` take an optional `project`; a name the acting user holds no project role in is refused before any content is read, and `project_list` lists the readable ones. `content_localize` takes the layer and the item's id, which is the same in every project, plus the translated `displayName` and top-level `data` fields, and for an inherited item defaults `language` to the layer's, as Content Studio's Localize does, so `project` and `key` alone localize an item untranslated. It takes `expectedModifiedTime` like `content_update`. It writes to `draft` whatever `mcp.branch` says, and never publishes. It refuses a project without a parent, an item created in the layer itself, and an inherited item the call would not change, since only a real change localizes it. Item sets cannot be translated yet, and HtmlArea markup is written as given.

`content_create` always writes to the `draft` branch, whatever `mcp.branch` says, with `requireValid` on and the workflow state set to in-progress, so nothing an agent creates goes live until someone publishes it. XP reports only the first validation error, and none for a missing required field, so the tool first checks the data against the content type's occurrence rules and names the offending paths, the first ten per refusal plus a count of the rest. `content_type_get` expands nested item sets and option sets four levels deep; a set on the fifth level is listed, marked `capped`, without its fields.

The workflow tools are for administrators: they are listed only when the acting user holds `role:system.admin`, and each call checks the role again, so a user who lost it since `tools/list` is refused. To anyone else they answer with that reason rather than "Unknown tool". They follow the [Workflows](#workflows) and [Schedules](#schedules) rules of the admin tool and share its code. Runs are asynchronous: `workflow_run` returns a `runId` with status `running` (or `skipped` while another run is going), and `run_get` reads the result once it is `done` or `failed`. `cron_set` creates a workflow's schedule in `UTC` and enabled unless told otherwise, and every save makes the acting user the one the schedule runs as. For another application's job it takes the job `name` and `enabled` only, and keeps that job's user; a workflow schedule is always addressed by `workflowId`. Workflows themselves are created and edited in the admin tool, not over MCP. Results about a workflow carry an `adminUrl` to its page in the admin tool.

Each successful write by `content_create`, `content_update`, `content_localize`, `node_create`, `node_update`, `workflow_run`, `cron_set` or `cron_delete` also leaves one entry in XP's audit log, besides the entries XP writes for the change itself. The entry has type `grieg.mcp.<tool>`, the acting user as `user`, the written item in `objects`, and `tool` plus the written `fields` in `data` (for `cron_set`, the job fields the call changed). A content or node item, and the run node `workflow_run` creates, is written as `<repository>:<branch>:<id>` (the form XP uses for its own content entries, so a search by object finds both); a schedule is written as `scheduler:<job name>`. A refused, failed or no-op call writes none, and a failed audit write is logged without failing the call.

Summaries carry an `editUrl` into Content Studio. On the `draft` branch, edits need publishing in Content Studio to go live, and each edit resets the item's workflow state to in-progress.

### Cards in Claude Desktop

Claude Desktop and claude.ai render the results of `workflow_list`, `run_list`, `run_get`, `cron_list`, `node_query`, `node_get`, `node_repos`, `content_search`, `content_get` and `content_type_get` as interactive cards ([MCP Apps](https://github.com/modelcontextprotocol/ext-apps)) that follow the host's light or dark theme. Claude Code, and any client without MCP Apps support, shows the same tools as text, as before. A card refreshes itself, pages a query and drills down (a workflow to its runs, a run to its steps, a query hit to its node, a node to its children, a content hit to the item, an item to its content type, folder or children) by calling the read tools through the host, as the acting user, in the project the item came from; a layer item shows its project and an Inherited or Localized chip; it holds no key and makes no request of its own. It never writes: Run now, Enable, Disable and Delete schedule send Claude a request instead, so the write runs as a tool call behind the host's approval prompt and lands in the audit log. Desktop asks once before it shows a server's first card. The views are five `ui://grieg/*` resources built into the app as one self-contained HTML file; an app built without it logs `MCP serves no cards` once and serves the tools without views. Each card tool names its view in `_meta.ui.resourceUri`, in the deprecated flat `ui/resourceUri`, and in `openai/outputTemplate`, ChatGPT's alias for the same key.

### Authentication

Each user authenticates with a personal key, sent as `Authorization: Bearer grieg_…`, and every tool runs as that key's owner: the owner's own permissions apply, and Content Studio records the owner as the modifier, so an agent's edits cannot be told apart from the owner's own. Revoking one key affects nobody else.

On startup grieg creates the role `role:com.enonic.app.grieg.mcp`. A key is admitted only while its owner holds that role, directly or through a group, and is enabled. Both are checked on every request, so removing someone from the role or disabling them stops their key at once. A key expires 90 days after it was generated. The owner can be in any ID provider; XP builds their roles from stored memberships, which for an external ID provider are as fresh as that user's last interactive login. Roles live in `system-repo`, so the role stays after the app is uninstalled; delete it in the Users app if it is no longer wanted.

Each role member manages their own key in the admin tool's MCP tab, a three-step connect page: get a key, which is shown once and afterwards only as its masked form, expiry and last use; copy what the chosen client needs (Claude Desktop, Claude Code, ChatGPT, or other clients); and watch the first request arrive. Right after a key is generated the page checks it every 3 seconds for five minutes, while the page is visible, and turns to "Connected" on the key's first use; a key's first use is recorded at once, later uses at most hourly. The tab also states the toolsets the server serves, whether it is read-only, and whether the workflow tools are served to you. Admins also see and revoke every user's key there. A member who is not an admin sees only that tab. The tab uses the Keys API, which works with the XP login session that the admin tool runs in: `GET` returns the key's masked form and dates, `POST` with a JSON body generates a key, replacing the previous one, and returns the full key once, and `DELETE` removes it. An admin needs the role too to hold a key, and can also list every key (`GET ?all=true`) and revoke anyone's (`DELETE ?owner=user:<idprovider>:<login>`). A bearer that is not a `grieg_` key is compared with the deprecated shared `mcp.token` and runs as `mcp.user`, when both are set. The examples below use a personal key; a shared token goes in the same place.

### Claude Desktop

Install the grieg extension. The MCP tab's Claude Desktop step offers `grieg.mcpb` for download; it is an app asset, built from `dev/mcp-stdio.ts` into one dependency-free file and packed with the official `mcpb` CLI. Open the file, or drag it into Desktop under Settings, Extensions, and paste the endpoint URL and your key when Desktop asks. The bundle holds neither, so one public file serves every user, and Desktop keeps the key in its encrypted settings rather than in a config file. Desktop runs the extension with its own bundled Node on macOS and Windows.

Without extensions (a Linux build of Desktop, or a machine that blocks them), add an `mcp-remote` entry to `claude_desktop_config.json` instead (`~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows), then quit and reopen Desktop. This stores the key in plain text and needs Node. The header has no space and the key travels through `env`, because Desktop on Windows splits arguments on spaces. Add `--allow-http` for a plain-HTTP endpoint on any host other than `localhost` or `127.0.0.1`.

```json
{
  "mcpServers": {
    "grieg": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-remote@0.14.3",
        "http://localhost:8080/api/com.enonic.app.grieg:mcp",
        "--header",
        "Authorization:${AUTH_HEADER}"
      ],
      "env": { "AUTH_HEADER": "Bearer <key>" }
    }
  }
}
```

Desktop needs either bridge because a custom connector added by URL is called from Anthropic's cloud, which cannot reach a `localhost` XP. Once XP is reachable from the internet over TLS, a remote connector can take the endpoint directly and the bridge is no longer needed.

### Claude Code

Read the key into the environment without echoing it, so it never lands in shell history, then add the server; the shell expands the variable once, and Claude Code stores the header in your local configuration:

```bash
read -rs GRIEG_MCP_TOKEN && export GRIEG_MCP_TOKEN   # paste the key, press Enter
claude mcp add --transport http grieg http://localhost:8080/api/com.enonic.app.grieg:mcp \
  --header "Authorization: Bearer $GRIEG_MCP_TOKEN"
```

Or share it through `.mcp.json`, with each user's key in their own environment. Claude Code expands `${GRIEG_MCP_TOKEN}` in a remote server's headers. Only a fixed set of credential variables reads as empty there: Claude Code's own (`ANTHROPIC_API_KEY`), the cloud providers', and other common ones such as `NPM_TOKEN` and `HTTPS_PROXY`:

```json
{
  "mcpServers": {
    "grieg": {
      "type": "http",
      "url": "http://localhost:8080/api/com.enonic.app.grieg:mcp",
      "headers": { "Authorization": "Bearer ${GRIEG_MCP_TOKEN}" }
    }
  }
}
```

Tool names are `mcp__grieg__content_search` and so on, which is what permission allowlists match.

### Stdio clients

Clients that only speak MCP over stdio, or setups that keep the token out of the client config, can use `dev/mcp-stdio.ts`, the same forwarder `grieg.mcpb` runs. It is a dependency-free forwarder that POSTs each stdin message to the endpoint and writes the replies, JSON or SSE, to stdout. It needs Node 24 or newer and a checkout of this repository. Run it with `node` directly, not through `pnpm run`, which writes to stdout.

| Variable         | Meaning                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `MCP_URL`        | The endpoint URL. Required                                                                             |
| `MCP_TOKEN`      | The bearer: a personal key, or the shared token                                                        |
| `MCP_TOKEN_FILE` | A file holding the token, or an XP config with an `mcp.token = …` line, used when `MCP_TOKEN` is unset |

```bash
claude mcp add grieg --env MCP_URL=http://localhost:8080/api/com.enonic.app.grieg:mcp \
  --env MCP_TOKEN_FILE=$XP_HOME/config/com.enonic.app.grieg.cfg \
  -- node /path/to/grieg/dev/mcp-stdio.ts
```

```json
{
  "mcpServers": {
    "grieg": {
      "command": "node",
      "args": ["/path/to/grieg/dev/mcp-stdio.ts"],
      "env": {
        "MCP_URL": "http://localhost:8080/api/com.enonic.app.grieg:mcp",
        "MCP_TOKEN": "${GRIEG_MCP_TOKEN}"
      }
    }
  }
}
```

Both protocol eras pass through. The forwarder sets `MCP-Protocol-Version` from each request's `_meta`, or from the version `initialize` negotiated, plus `Mcp-Method` and `Mcp-Name`. A reply that is not JSON-RPC, such as XP's login page on a rejected token, or a network failure, reaches the client as a JSON-RPC error with code `-32000`. `notifications/cancelled` aborts the matching request. Logs go to stderr. Claude Code does not need the forwarder, since it speaks HTTP directly.

For a static token, the third-party `mcp-remote` (`npx mcp-remote <url> --header "Authorization: Bearer <token>" --protocol auto`) is an alternative.

### ChatGPT

ChatGPT cannot use a personal key yet. Its form for a custom MCP server offers OAuth, no authentication, or a mix of the two, and has no field for a header, while grieg does not offer OAuth sign-in yet. The ChatGPT tab of the MCP tab's connect step says so, and shows the endpoint and the steps to add a server: on chatgpt.com, Plugins, the plus button, Add custom MCP server; a name, the server URL or a tunnel under Connection, the authentication; confirm the risk warning and select Create as a plugin; then type `@` in a chat and pick grieg. Which ChatGPT plans can add a custom server has not been verified: OpenAI's guide names none, and says workspace permissions apply.

Every tool declares `readOnlyHint`, `destructiveHint` and `openWorldHint`, which ChatGPT lists as required and uses to frame its confirmation; it treats a tool without `readOnlyHint` as a write. `content_update` and `cron_delete` are marked destructive, and `workflow_run`, which calls Vertex AI, open-world.

#### Demo through a Secure MCP Tunnel

For a demo, OpenAI's [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) can run the [stdio forwarder](#stdio-clients) with one key, on a machine that reaches XP; XP itself need not be reachable from the internet.

> [!WARNING]
> ChatGPT connects to a tunnel with no authentication, so everyone who can use the plugin acts as the key's owner, with that owner's permissions and under their name in the audit log. Use a dedicated user with the MCP role and only the permissions the demo needs, and revoke its key afterwards.

1. Create a tunnel in the OpenAI Platform's tunnel settings, associated with the ChatGPT workspace, and install `tunnel-client`.
2. Generate a key as the dedicated user, and save it in a file only you can read:

   ```bash
   (umask 077 && read -rs KEY && printf '%s\n' "$KEY" > ~/.grieg-chatgpt-key)   # paste, Enter
   ```

3. Create a profile that starts the forwarder, then check and run it, keeping it running for the demo:

   ```bash
   export CONTROL_PLANE_API_KEY="sk-..."
   tunnel-client init --sample sample_mcp_stdio_local --profile grieg \
     --tunnel-id tunnel_… \
     --mcp-command "env MCP_URL=http://localhost:8080/api/com.enonic.app.grieg:mcp MCP_TOKEN_FILE=$HOME/.grieg-chatgpt-key node /path/to/grieg/dev/mcp-stdio.ts"
   tunnel-client doctor --profile grieg --explain
   tunnel-client run --profile grieg
   ```

4. In ChatGPT, add the custom MCP server with Tunnel under Connection, pick the tunnel, and No authentication.

OpenAI's documentation does not say whether `tunnel-client` passes its own environment to the command it starts, or whether it splits `--mcp-command` through a shell. The `env` prefix sets both variables on the command itself, so it does not rely on the first; keep the paths free of spaces for the second. Neither has been tried against a live tunnel, nor has a card been seen rendering in ChatGPT.

#### Origin and cookies

Through the tunnel, the forwarder makes the requests, so grieg sees neither an `Origin` nor a cookie, as from any stdio client. Whether ChatGPT's own servers send either when they call an endpoint directly has not been checked. If they send `Origin: https://chatgpt.com`, grieg refuses it as not same-origin, logging the value, until `https://chatgpt.com` is added to `mcp.allowedOrigins`. A request with a cookie is refused whatever the configuration.

### Troubleshooting

A rejected bearer gets `401`, but XP replaces the body with its login page, so the reason is only in the XP log as a `MCP request … rejected` warning. For a personal key it is one of: unknown key (never generated, regenerated or deleted), expired, owner no longer exists, owner disabled, or owner does not hold `role:com.enonic.app.grieg.mcp`; the warning names the owner, never the key. For any other bearer it is a missing or invalid token, or shared-token mode being off. The same applies to a disallowed `Origin` or `Host` and to a request carrying cookies: the endpoint answers 403, but XP turns a 403 for an anonymous caller into its 401 login challenge. An `Origin` or `Host` warning names the rejected value and the config key that would admit it. A cookie warning lists the cookie names, never their values, and a bearer warning says only whether the token was missing or invalid.

```bash
curl -sX POST http://localhost:8080/api/com.enonic.app.grieg:mcp \
  -H 'Authorization: Bearer grieg_…' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Conformance

`pnpm conformance` runs the official suite (`@modelcontextprotocol/conformance`, pinned) with `--requirements 2026-07-28` against a running XP with grieg deployed. The suite sends no auth, so the script puts a local proxy on port 3999 that adds `GRIEG_MCP_TOKEN` as the bearer, a personal key or the shared token, and forwards `Host` unchanged.

```bash
GRIEG_MCP_TOKEN=grieg_… pnpm conformance            # GRIEG_XP_URL defaults to http://localhost:8080
GRIEG_MCP_TOKEN=grieg_… pnpm conformance --update   # rewrite the allowlist from this run
```

It fails when a check listed in `dev/conformance-allowlist.json` stops passing, and prints checks that pass but are not listed yet. Run it against an XP that routes any `Host` to the endpoint. With `vhost.enabled` and no mapping for the suite's `evil.example.com`, XP answers 404 itself, and the DNS-rebinding scenario passes without reaching grieg's check. Most failing scenarios need suite fixtures or optional features grieg does not implement, so the gate is the allowlist rather than the suite's exit code. Results land in `.tmp/conformance/`.

The API descriptor is open to everyone by design — the bearer is the gate, so treat a key as a credential and serve the endpoint over TLS.
