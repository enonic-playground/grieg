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
mcp.principal = role:system.admin
```

## MCP

The endpoint speaks JSON-RPC 2.0 over a single HTTP POST — `initialize`, `ping`, `tools/list`, `tools/call`. Tools cover content CRUD: `content_get`, `content_query`, `content_create`, `content_modify`, `content_delete`.

```bash
curl -sX POST http://localhost:8080/api/com.enonic.app.grieg:mcp \
  -H 'Authorization: Bearer change-me' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The API descriptor is open to everyone by design — the token is the gate, so treat it as a credential and serve the endpoint over TLS.
