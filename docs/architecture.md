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
- Shared guidance was repeated in persona defaults and appended at runtime, while agent discovery made system prompt size unbounded. `prompts.js` now owns only shared rules, capability guidance, and composition of the editable instructions. `personas.js` seeds detailed Sunday/general and coding instructions into the editable field. Sunday owns general outcomes and coordination; Coding Agent owns source inspection, minimal root-cause changes, and regression verification. Editing or clearing those instructions replaces or removes the role guidance; there is no hidden hardcoded persona override.
- `personas.js` owns seed metadata and exact historical-default migrations. Legacy built-in profiles cleared by the previous release regain editable defaults. Customized text remains unchanged. An instruction-version marker makes restoration a one-time migration, so subsequently saving an empty field remains empty across reads/restarts. Removed voice-version generation performed identical string replacements because the historical defaults contained neither voice string.
- Roughly 3,000 characters for shared rules plus the seeded persona instructions is a writing guideline, not a runtime or save limit. There is no assembled-system-prompt cap. The existing 8,000-character persona instruction validation/UI limit remains unchanged. Tool guidance and runtime context are not part of that estimate.

Runtime data outside the persona system prompt is explicit: allowed repository names and discoverable agent IDs/responsibilities are JSON reference data appended only to the copied latest user-role model message, labeled untrusted session context. This does not alter stored messages. Retrieved notes, compaction summaries, delegated responses, file references, tool schemas, and tool results remain separate runtime inputs, not hidden persona instructions. Agent discovery reuses the existing `agent_list` tool; no speculative tool was added.

Verification:

- `npm test`: **326 passed, zero failures**. Regression coverage includes capability restrictions, child-preset permission intersection, ordered/concurrent dispatch, editable seeded instructions, customization/empty-field migration, long instructions, API persistence, and runtime context separation.
- Prompt tests cover both seeded personas plus a custom persona across all 32 runtime capability combinations. They verify instructions are included unchanged and editing/clearing them leaves no hidden role instructions. Instructions up to the existing 8,000-character limit are accepted without an assembled 3,000-character cap.
- `npm run build`: passed. `git diff --check`: passed. No lint or type-check script is configured in `package.json`.
