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
pnpm check          # lint + type-check + tests
./gradlew build     # full app jar
./gradlew deploy -t -Penv=dev   # build + deploy to the running sandbox, in watch mode
```

## Configuration

Create `$XP_HOME/config/com.enonic.app.grieg.cfg`:

```properties
# Content context the MCP tools operate in. With `mcp.branch = master`, edits made with a
# personal key go live at once under the key owner's name.
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

# Toolsets to serve, comma-separated: `content` (content_*) and `nodes` (node_*). Unknown
# names are ignored with a log warning; a blank value serves no tools at all.
mcp.toolsets = content,nodes

# `true` removes content_update, content_create, node_create and node_update from `tools/list`, and refuses
# them if called anyway.
mcp.readOnly = false

# Repositories the node tools may use, comma-separated exact ids. Empty means every
# repository except `system-repo` and `system.*`, which are always denied.
mcp.nodes.repos =
```

> [!IMPORTANT]
> `mcp.token` and `mcp.user` are deprecated. Give each user a personal key (see [MCP](#mcp)), then unset both. An install that keeps them set keeps working as before.

A request that carries an `Origin` header is accepted only when that origin is listed in `mcp.allowedOrigins`, or when it is same-origin with the request (scheme, host and port, as XP resolves them with `X-Forwarded-*` headers) on a trusted host. Same-origin alone is not enough, since in a DNS-rebinding attack both headers name the attacker's host. A request that carries any cookie is refused outright: MCP clients send none, and XP would otherwise admit a logged-in admin's browser session.

XP picks up changes to this file without a restart.

## MCP

The endpoint is `http://<host>:8080/api/com.enonic.app.grieg:mcp`, a stateless MCP server over HTTP POST. It speaks protocol `2026-07-28` (`server/discover` plus per-request `_meta`) and the legacy `initialize` handshake (`2025-11-25`, `2025-06-18`, `2025-03-26`) from the same URL.

| Tool               | Does                                                                                           |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `content_search`   | Full-text search by `text`, or list the children of `path`; compact summaries and a cursor     |
| `content_get`      | One item by id or path, with `data` (default), `x`, `page`, `attachments` or `fields`          |
| `content_type_get` | A content type's fields as dot paths, with input type, occurrences and config, depth-capped    |
| `content_update`   | Change `displayName`, `language` or top-level scalar `data` fields, with conflict checking     |
| `content_create`   | Create an item on draft, in progress, validated against its content type                       |
| `node_repos`       | Repositories and branches the acting user can read, with whether the node tools may write them |
| `node_query`       | lib-node query (DSL or NoQL) with filters, sort, capped aggregations, `fields` and a cursor    |
| `node_get`         | One node by id or path, with `data` (default), `permissions`, `indexConfig` or `fields`        |
| `node_create`      | Create a node under a parent; permissions are inherited and cannot be set                      |
| `node_update`      | `set` and `unset` dot paths on a node, with `expectedVersionKey` conflict checking             |

`node_update` keeps a property's type: a `set` on a date, time, geo point or reference takes the string `node_get` shows for it and stores it as that type again. A `set` over a link, a binary reference or a property holding several typed values is refused, since a string would replace its type. Xml properties read as plain strings, so a `set` on one stores a String.

The node tools run as the acting user too, so XP's node permissions decide what they can read and write. `system-repo` and `system.*` repositories are never available. `com.enonic.cms.*` repositories are read-only through `node_*`, since a lib-node write would bypass content validation, the workflow reset and project roles; content writes go through `content_update`. Branches default to `draft` for content repositories and `master` elsewhere. `expectedVersionKey` is checked inside lib-node's update editor, which has no lock: it catches a write that landed since your read, but not one landing during the update itself.

`content_create` always writes to the `draft` branch, whatever `mcp.branch` says, with `requireValid` on and the workflow state set to in-progress, so nothing an agent creates goes live until someone publishes it. XP reports only the first validation error, and none for a missing required field, so the tool first checks the data against the content type's occurrence rules and names the offending paths, the first ten per refusal plus a count of the rest. `content_type_get` expands nested item sets and option sets four levels deep; a set on the fifth level is listed, marked `capped`, without its fields.

Summaries carry an `editUrl` into Content Studio. On the `draft` branch, edits need publishing in Content Studio to go live, and each edit resets the item's workflow state to in-progress.

### Authentication

Each user authenticates with a personal key, sent as `Authorization: Bearer grieg_…`, and every tool runs as that key's owner: the owner's own permissions apply, and Content Studio records the owner as the modifier, so an agent's edits cannot be told apart from the owner's own. Revoking one key affects nobody else.

On startup grieg creates the role `role:com.enonic.app.grieg.mcp`. A key is admitted only while its owner holds that role, directly or through a group, and is enabled. Both are checked on every request, so removing someone from the role or disabling them stops their key at once. A key expires 90 days after it was generated. The owner can be in any ID provider; XP builds their roles from stored memberships, which for an external ID provider are as fresh as that user's last interactive login. Roles live in `system-repo`, so the role stays after the app is uninstalled; delete it in the Users app if it is no longer wanted.

Each role member manages their own key in the admin tool's MCP tab, which shows a new key once together with a ready `claude mcp add` command and `.mcp.json` block, then only its masked form, expiry and last use; admins also see and revoke every user's key there. A member who is not an admin sees only that tab. The tab uses the Keys API, which works with the XP login session that the admin tool runs in: `GET` returns the key's masked form and dates, `POST` with a JSON body generates a key, replacing the previous one, and returns the full key once, and `DELETE` removes it. An admin needs the role too to hold a key, and can also list every key (`GET ?all=true`) and revoke anyone's (`DELETE ?owner=user:<idprovider>:<login>`). A bearer that is not a `grieg_` key is compared with the deprecated shared `mcp.token` and runs as `mcp.user`, when both are set. The examples below use a personal key; a shared token goes in the same place.

### Claude Code

```bash
claude mcp add --transport http grieg http://localhost:8080/api/com.enonic.app.grieg:mcp \
  --header "Authorization: Bearer <key>"
```

Or share it through `.mcp.json`, keeping the key in the environment:

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

Clients that only speak MCP over stdio, or setups that keep the token out of the client config, can use `dev/mcp-stdio.ts`. It is a dependency-free forwarder that POSTs each stdin message to the endpoint and writes the replies, JSON or SSE, to stdout. It needs Node 24 or newer and a checkout of this repository. Run it with `node` directly, not through `pnpm run`, which writes to stdout.

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
