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

## MCP discovery and execution bridge

The chat runtime does not run `AgentSession.prompt()`: it owns its model loop. Copying an SDK session's tools is therefore not enough to reproduce the SDK's discovery/execution behavior.

Confirmed causes and changes:

- `createAgentSession({ tools: [] })` means **no allowed tools**, not merely no active filesystem tools. With the installed SDK this exposed **zero MCP tools**, even after a connected server finished initializing. Sunday now uses `noTools: true` and explicit `+codemode`/`+tool_search` modifiers. This activates discovery while keeping filesystem tools inactive and permitting dynamically discovered MCP tools. No per-agent MCP enable step was added; globally enabled servers retain their existing access policy.
- `connectMcp().prepare()` runs the SDK's `before_agent_start` hook without starting another model request. This preserves direct-server startup readiness and the SDK's enabled-server discovery section. The outer chat adds that section, configured server names, and sanitized diagnostics as **untrusted reference data**, not hidden persona instructions. Shared system guidance tells the agent to attempt discovery before claiming MCP access is unavailable. Editable persona instructions and the absence of a hard 3,000-character prompt cap are unchanged.
- `tool_search` changes the SDK's active tool set. Sunday now refreshes declarations before every model round, so a tool loaded during discovery can be called on the next round.
- Calling a raw `tool.execute()` bypassed SDK readiness, validation, and result hooks. The bridge now uses the SDK core `runToolCall` pipeline, preserving the actual issuing assistant message for nested codemode calls. SDK failures become failed Sunday tool results, not successful strings. `@earendil-works/pi-agent-core` **1.3.0**, already installed transitively at that version, is now an explicit direct dependency; no dependency version upgrade was needed.
- Warning/error notifications and extension errors were discarded. They now become actionable diagnostics in model reference context and tool results. Only known server names and predefined messages are forwarded: raw SDK transport errors, URLs, headers, and credentials are not copied into diagnostics. Authentication-required messages direct the user to sign in again; other failures direct them to server configuration/connectivity. The Settings “Signed in” label still means stored credentials, not verified connectivity.
- Aborting a chat closes its MCP transports; repeated close calls share one shutdown promise and remove the abort listener. Failed initialization disposes the session. Empty/disabled configurations do not start SDK sessions or expose discovery tools.

Verification:

- Tests use a real local stdio JSON-RPC MCP fixture and the installed SDK—not mocked discovery. They cover delayed startup, direct/deferred/codemode exposure, dynamic declarations, real calls, schema validation, remote tool errors, denied filesystem access, disabled servers, HTTP authentication-required behavior, sanitized connection failures, cancellation during discovery, idempotent shutdown/subprocess cleanup, and isolation between agent sessions.
- Chat-loop integration tests run the real adapter against a controlled MCP server with a deterministic model stream. They verify discovery → refreshed declarations → tool execution, failure diagnostics, and failed execution status. This does not claim a live model will always choose the correct tool.
- Read-only discovery against the locally configured **DatadogUS5** server succeeded with stored sign-in credentials. `tool_search` loaded three real Datadog tool declarations and reported no connection diagnostics. No Datadog mutation or service-data tool was invoked. A separate metadata-call check stopped before invocation because the chosen metadata tool requires a telemetry argument; live query execution is not claimed. Controlled integration tests verify the full execution path.
- Final verification: focused MCP/chat/prompt/settings tests **65 passed, zero failures**; `npm test` **340 passed, zero failures**; `npm run build` passed; `git diff --check` passed. No lint/type-check script is configured. These results verify this bridge change, not a production deployment or a live Datadog query.
