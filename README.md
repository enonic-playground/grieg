# grieg

Enonic XP application that orchestrates AI integrations, scheduled jobs and workflows.

## Surfaces

| Surface       | Path                                  | Access               |
| ------------- | ------------------------------------- | -------------------- |
| Admin tool    | `admin/tools/main`                    | `role:system.admin`  |
| System API    | `/api/com.enonic.app.grieg:system`    | `role:system.admin`  |
| Workflows API | `/api/com.enonic.app.grieg:workflows` | `role:system.admin`  |
| Crons API     | `/api/com.enonic.app.grieg:crons`     | `role:system.admin`  |
| MCP API       | `/api/com.enonic.app.grieg:mcp`       | public, bearer token |

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
# Shared secret clients send as `Authorization: Bearer <token>`.
# The MCP endpoint refuses every request while this is unset.
mcp.token = change-me

# Content context the MCP tools operate in.
mcp.project = default
mcp.branch = draft

# XP user the tools act as, in the `mcp.idProvider` ID provider. Required: there is no
# default, and the endpoint refuses every request while it is unset. Its own permissions
# apply, and Content Studio shows it as the modifier. A missing or disabled user makes every
# tool call fail rather than run anonymously.
mcp.user = editor
mcp.idProvider = system

# Browser origins allowed to call the endpoint, comma-separated. Empty by default. CLI
# clients such as Claude Code send no `Origin` and are not affected.
mcp.allowedOrigins =

# Hostnames, without port, that a same-origin browser request may target, comma-separated.
# `localhost`, `127.0.0.1` and `[::1]` are always trusted.
mcp.allowedHosts =
```

> [!IMPORTANT]
> `mcp.user` no longer defaults to `su`. An install that relied on the default has its MCP endpoint disabled until `mcp.user` is set.

A request that carries an `Origin` header is accepted only when that origin is listed in `mcp.allowedOrigins`, or when it is same-origin with the request (scheme, host and port, as XP resolves them with `X-Forwarded-*` headers) on a trusted host. Same-origin alone is not enough, since in a DNS-rebinding attack both headers name the attacker's host. A request that carries any cookie is refused outright: MCP clients send none, and XP would otherwise admit a logged-in admin's browser session.

XP picks up changes to this file without a restart.

## MCP

The endpoint is `http://<host>:8080/api/com.enonic.app.grieg:mcp`, a stateless MCP server over HTTP POST. It speaks protocol `2026-07-28` (`server/discover` plus per-request `_meta`) and the legacy `initialize` handshake (`2025-11-25`, `2025-06-18`, `2025-03-26`) from the same URL.

| Tool             | Does                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `content_search` | Full-text search by `text`, or list the children of `path`; returns compact summaries      |
| `content_get`    | One item by id or path, with `data` (default), `x`, `page` or `attachments` on request     |
| `content_update` | Change `displayName`, `language` or top-level scalar `data` fields, with conflict checking |

Summaries carry an `editUrl` into Content Studio. On the `draft` branch, edits need publishing in Content Studio to go live, and each edit resets the item's workflow state to in-progress.

### Claude Code

```bash
claude mcp add --transport http grieg http://localhost:8080/api/com.enonic.app.grieg:mcp \
  --header "Authorization: Bearer <token>"
```

Or share it through `.mcp.json`, keeping the token in the environment:

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

### Troubleshooting

A rejected token gets `401`, but XP replaces the body with its login page, so the reason (disabled endpoint, missing or invalid token) is only in the XP log as a `MCP request … rejected` warning. The same applies to a disallowed `Origin` or `Host` and to a request carrying cookies: the endpoint answers 403, but XP turns a 403 for an anonymous caller into its 401 login challenge. An `Origin` or `Host` warning names the rejected value and the config key that would admit it, and a disabled-endpoint warning names the key to set. A cookie warning lists the cookie names, never their values, and a bearer warning says only whether the token was missing or invalid.

```bash
curl -sX POST http://localhost:8080/api/com.enonic.app.grieg:mcp \
  -H 'Authorization: Bearer change-me' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

### Conformance

`pnpm conformance` runs the official suite (`@modelcontextprotocol/conformance`, pinned) with `--requirements 2026-07-28` against a running XP with grieg deployed. The suite sends no auth, so the script puts a local proxy on port 3999 that adds the bearer token and forwards `Host` unchanged.

```bash
GRIEG_MCP_TOKEN=change-me pnpm conformance            # GRIEG_XP_URL defaults to http://localhost:8080
GRIEG_MCP_TOKEN=change-me pnpm conformance --update   # rewrite the allowlist from this run
```

It fails when a check listed in `dev/conformance-allowlist.json` stops passing, and prints checks that pass but are not listed yet. Run it against an XP that routes any `Host` to the endpoint. With `vhost.enabled` and no mapping for the suite's `evil.example.com`, XP answers 404 itself, and the DNS-rebinding scenario passes without reaching grieg's check. Most failing scenarios need suite fixtures or optional features grieg does not implement, so the gate is the allowlist rather than the suite's exit code. Results land in `.tmp/conformance/`.

The API descriptor is open to everyone by design — the token is the gate, so treat it as a credential and serve the endpoint over TLS.
