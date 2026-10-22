# Working on Sunday

## Verify

- Install: `npm ci` (Node >=22.19).
- Tests: `npm test`; focused: `node --test test/<feature>.test.js`.
- Production build: `npm run build`.
- Commit independently verified changes in small checkpoints.

## Context map

- Server startup, HTTP routes, credentials, sessions, chat streaming: `src/server/index.js`; provider/model registries and mode-scoped credential adapters: `src/server/provider-models.js`.
- JSON persistence: `src/server/storage.js`; focused tests beside the module.
- Tool definitions and repository access policy: `src/server/tools.js`; SQLite context indexing/search: `src/server/context-storage.js`.
- MCP configuration validation, transports, SDK discovery/execution hooks, and sanitized diagnostics: `src/server/mcp.js`; settings UI: `src/web/components/Settings.jsx`.
- Shared system prompt composition: `src/server/prompts.js`; seeded persona metadata and legacy instruction migration: `src/server/personas.js`; effective built-in tool grants: `src/server/agent-capabilities.js`; ordered/concurrent tool batches: `src/server/tool-dispatch.js`.
- Context budgeting, thinking levels, repository status, session names: corresponding named modules in `src/server/`.
- Frontend composition, navigation, chat streaming: `src/web/App.jsx`.
- Feature UI: `src/web/components/` (SessionConfig = per-agent settings; Settings = global defaults; Memory = Context index UI).
- HTTP client: `src/web/api.js`; composer parsing: `src/web/composer.js`.
- Shared and feature styles: `src/web/style.css`.
- Behavioral and integration tests: `test/`, named by feature.

Read the owning module and relevant tests before editing. Use direct imports and explicit dependencies. Extract cohesive responsibilities, not trivial forwarding layers. Update this map when ownership changes. See `docs/architecture.md` for boundaries.
