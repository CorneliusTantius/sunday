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

## Agent capability and prompt refactor

Audit findings and intentional changes:

- Tool exposure, prompt guidance, and execution previously computed overlapping grants separately; disabled delegation could still be advertised. `agent-capabilities.js` resolves effective built-in grants from profile permissions, repository access, child status, delegation settings, and whisper availability. Runtime exposure and dispatch use the same resolved list. Existing MCP tools retain their separate connection/dispatch policy.
- A configured child persona previously replaced inherited permissions. Child grants now intersect the selected persona with the parent's grants; selecting a powerful preset cannot elevate a restricted parent's child. Existing repository restrictions and child nesting/whisper restrictions remain enforced.
- Dispatch previously collected all delegation calls and moved them ahead of intervening calls. `tool-dispatch.js` now batches only contiguous known read-only calls or contiguous delegation calls, preserves result order, and leaves mutations and unknown/MCP calls sequential. This improves independent reads without moving later work across a write. Dependent operations must still be requested in separate model turns.
- Shared guidance was repeated in persona defaults and appended at runtime, while agent discovery made system prompt size unbounded. `prompts.js` now owns shared rules, identity-selected Sunday/general versus coding responsibilities, capability guidance, and custom instructions. No runtime system-prompt suffix remains. Sunday owns general outcomes and coordination; Coding Agent owns source inspection, minimal root-cause changes, and regression verification. Renaming a persona does not switch its role.
- `personas.js` owns seed metadata and exact historical-default migrations. Built-in instruction fields now hold only custom additions, not duplicated built-in rules. Exact known historical defaults migrate to empty customization; genuinely customized instructions remain unchanged. Removed voice-version generation performed identical string replacements because the historical defaults contained neither voice string.
- The complete system prompt must fit 3,000 JavaScript string characters; nothing is silently truncated. Persona/session creation and profile updates validate against all granted built-in capabilities. Existing oversized custom profiles remain readable but must be shortened before successful model execution. The UI describes the shared budget and displays save errors.

Runtime data outside the persona system prompt is explicit: allowed repository names and discoverable agent IDs/responsibilities are JSON reference data appended only to the copied latest user-role model message, labeled untrusted session context. This does not alter stored messages. Retrieved notes, compaction summaries, delegated responses, file references, tool schemas, and tool results remain separate runtime inputs, not hidden persona instructions. Agent discovery reuses the existing `agent_list` tool; no speculative tool was added.

Verification:

- `npm test`: 326 tests passed, zero failures (includes capability restrictions, child-preset permission intersection, ordered/concurrent dispatch, persona selection/migration, API budget rejection, and runtime context separation).
- Prompt tests cover both seeded personas plus a custom persona across all 32 runtime capability combinations, and exact 3,000/3,001-character boundary behavior. All-capability built-in prompts measure Sunday **2,306** and Coding Agent **2,370** characters, including shared and role instructions.
- `npm run build`: passed. `git diff --check`: passed. No lint or type-check script is configured in `package.json`.
