# Architecture

Sunday uses Node HTTP, Preact, Vite, and the pi SDK.

## Ownership

`src/server/index.js` initializes workspaces and providers, owns mutable state and its serialization queue, and handles HTTP and chat execution. `storage.js` reads and atomically replaces JSON files; callers own validation and concurrency. Filenames are trusted internal values, not user input.

`src/web/App.jsx` owns composition, navigation, session selection, and streaming. Feature components use `api.js`. Agent configuration belongs to the session API; global defaults belong to the settings API.

## Invariants

- Preserve persisted formats and HTTP payloads during extraction.
- Preserve mutation serialization, atomic writes, and private file permissions.
- Preserve repository path validation, sensitive-file restrictions, and credential handling.
- Preserve stream cancellation, cleanup, timeouts, and session isolation.
- Preserve CSS cascade order and responsive overflow behavior.

## Next boundaries

Candidates: credential/provider setup, session request handlers, sidebar composition, and chat streaming lifecycle. Extract one cohesive responsibility per verified commit. Use explicit dependencies and direct imports, not generic service layers or empty feature directories. Avoid framework migrations during extraction.

Prefer behavior tests. Existing source-inspection tests may need updates when ownership moves; retain the behavior they protect. The context map is in `AGENTS.md` and must track ownership changes.
