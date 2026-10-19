# Working on Sunday

## Verify

- Install: `npm ci` (Node >=22.19).
- Tests: `npm test`; focused: `node --test test/<feature>.test.js`.
- Production build: `npm run build`.
- Commit independently verified changes in small checkpoints.

## Context map

- Server startup, HTTP routes, credentials, sessions, chat streaming: `src/server/index.js`; provider/model registries and mode-scoped credential adapters: `src/server/provider-models.js`.
- JSON persistence: `src/server/storage.js`; focused tests beside the module.
- Tool definitions, repository access policy, shared memory: `src/server/tools.js`.
- MCP configuration validation, transports, and tool connections: `src/server/mcp.js`; settings UI: `src/web/components/Settings.jsx`.
- Prompts, context budgeting, thinking levels, repository status, session names: corresponding named modules in `src/server/`.
- Frontend composition, navigation, chat streaming: `src/web/App.jsx`.
- Feature UI: `src/web/components/` (SessionConfig = per-agent settings; Settings = global defaults).
- HTTP client: `src/web/api.js`; composer parsing: `src/web/composer.js`.
- Shared and feature styles: `src/web/style.css`.
- Behavioral and integration tests: `test/`, named by feature.

Read the owning module and relevant tests before editing. Use direct imports and explicit dependencies. Extract cohesive responsibilities, not trivial forwarding layers. Update this map when ownership changes. See `docs/architecture.md` for boundaries.
