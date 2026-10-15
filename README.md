# Sunday

A local Node.js + Preact + Vite chat app using the pi AI SDK (`@earendil-works/pi-ai`, the current package name). Streaming chat with reusable personas and optional repository-scoped file tools.

## Install

Requires Git, npm, and Node.js 22.19+. Install with one command:

```sh
curl -fsSL https://raw.githubusercontent.com/CorneliusTantius/sunday/main/install.sh | sh
```

After installation, run `cd ~/sunday/sunday && npm start` and open http://localhost:3000.

The installer clones the app into `~/sunday/sunday`, creates `~/sunday/workspace/repos` and `~/sunday/data/sessions`, initializes `settings.json` and `auth.json`, installs dependencies, and builds the app. Existing settings, credentials, sessions, repositories, and checkout changes are preserved. It does not pull updates into an existing checkout or start a background service. Personas and installation identity are initialized on first launch.

## Run

Requires Node.js 22.19+.

```sh
npm install
npm run dev
```

Open http://localhost:3000. In Settings, choose OpenAI, Anthropic, or Google and save its API key. Connected providers expose their models; select a default model and thinking level, then save. OpenAI also supports Sign in with ChatGPT (the current OpenAI OAuth flow, not legacy Codex). Start sign-in and click the displayed browser link; paste the final callback URL if prompted. Reopening Settings resumes a pending sign-in, and Cancel sign-in lets you restart. Pending sign-ins expire after five minutes. Model access depends on your account.

```sh
npm run build
npm start
```

To run Sunday in the background with systemd, use the per-user service installer from the repository root:

```sh
./install-systemctl.sh
systemctl --user status sunday.service
journalctl --user -u sunday.service -f
```

The installer registers `npm start`, enables restart-on-exit, and installs a one-minute healthcheck timer that restarts Sunday if `/api/health` fails. It may ask for your password to enable systemd lingering, which keeps the user service running after logout and across reboots. Stop or disable it with `systemctl --user disable --now sunday.service sunday-healthcheck.timer`. To use a non-default port, run `PORT=3001 ./install-systemctl.sh`.

`PORT=3001 npm run dev` changes the port. The server binds only to loopback. To expose it privately to your tailnet, start the app and run Tailscale Serve in a second terminal:

```sh
npm start
# In another terminal:
tailscale serve --bg http://127.0.0.1:3000
tailscale serve status
```

Tailscale Serve provides an HTTPS tailnet URL and proxies to the loopback server; it does not expose the app publicly. If using a custom `PORT`, use that port in the Serve target. The app has no user login, so tailnet access controls are the security boundary—do not use Tailscale Funnel to make it public.

## Source layout

- `src/server/index.js`: HTTP API, development middleware, and production static serving.
- `src/server/tools.js`: repository-scoped file tools.
- `src/web/`: Preact frontend, built by Vite into `dist/`.
- `vite.config.js`: frontend root and Preact preset.

`npm run dev` and `npm start` launch `src/server/index.js`. Production serves `dist/` relative to the server module, independent of the launch directory or workspace working directory. The installer uses `npm ci` and `npm run build`; no separate frontend install is needed.

## Storage

- `~/sunday/data/settings.json`: selected provider, authorization mode, default model/thinking level, and a stable installation UUID required by OpenAI sign-in.
- `~/sunday/data/auth.json`: provider API keys and ChatGPT OAuth credentials (`openai-chatgpt`), stored separately so connecting one provider does not overwrite another. OAuth refresh is handled by pi and saved here.

Files are written atomically with owner-only permissions (0600). Secrets are stored as plaintext on disk, not encrypted. They are never returned by settings endpoints or stored in browser localStorage. An `OPENAI_API_KEY` environment variable can also supply API authorization.

Agent sessions persist in `~/sunday/data/sessions/<session-id>.json` and appear in the sidebar. Reload restores the last opened agent; New agent creates a separate session without deleting previous agents. Stop cancels the response and saves any generated partial text.

The server launch working directory is `~/sunday/workspace`; source repositories are stored under `~/sunday/workspace/repos`. Each agent gets an isolated workspace at `~/sunday/workspace-agents/<agent-name>`, containing copies of its allowed repositories directly. Folder names are safely derived from the agent name and follow it when renamed. New agents copy all available repositories by default. Saving agent settings copies newly checked repositories in and removes unchecked copies; edits stay isolated to that agent. Persona settings select allowed repository tools, which are unavailable when no repositories are selected. Every agent also has `memory_search` and `memory_update` tools for shared Markdown notes under `~/sunday/workspace/shared-memory/`. The interface uses neutral Void (`#090B10`), Surface (`#11151D`), Elevated (`#1A202B`), and Steel (`#303846`) layers, with cyan actions, blue selection, violet branding, magenta destructive actions, lime connection status, and amber warnings.

## Files

The Files page initially opens at `~/sunday/`, with a folder tree on the left and a CodeMirror 6 editor on the right. Enter an absolute directory or a home-relative path (`~` or `~/notes`) and select Open to browse elsewhere; Up opens the parent directory. Paths refer to the server's filesystem, not the browser's device. The last successfully opened directory, expanded folder, and file are remembered in browser localStorage and restored when returning to Files or refreshing the page. File contents and unsaved edits are not stored there. Search matches filenames under the selected directory. Save existing UTF-8 text files with Save or Ctrl/Cmd+S. Unsaved edits are protected when switching files or leaving the page. Saves check for on-disk changes before atomically replacing a file; external editors do not share the save lock, so avoid editing the same file simultaneously.

File access is restricted to the selected directory and the server user's filesystem permissions. Authentication files, sensitive paths, symlinks, hard-linked files, binary files, and text files over 256 KiB cannot be edited. The file API uses Linux `/proc/self/fd` and rechecks pinned paths; this is not filesystem isolation against hostile concurrent renames. Anyone granted access to Sunday can edit these files, including application source; keep the app private.

## Checks

`npm test` checks session persistence, independent provider credentials, connected-only model catalogs, stable installation identity, and that OAuth mode cannot fall back to an API key. `npm run build` checks the Vite production build. Live OpenAI requests and OAuth require your credentials and account access.

### Persistent subagents

A top-level agent can manage up to three reusable child sessions using
`create_subagent` (optional `prompt`), `send_subagent_prompt` (`sessionId`,
`prompt`), and `list_subagents`. Assignment returns immediately; busy children
reject another assignment. Children use a separate bird-name pool and appear
beneath their parent in the sidebar, where they can be opened like ordinary chats.
They inherit initial profile/model/repository access but have independent history
and isolated repository copies. Children cannot manage children or whisper to
other agents. Existing unrestricted tool profiles gain these tools automatically;
custom restricted profiles must explicitly enable them.

Each completed child turn saves a durable notification (including failures and
cancellations). The server delivers it when the parent is idle and starts a parent
turn to review it. Notification IDs prevent duplicate transcript delivery during
recovery. An interrupted model generation itself is not automatically resumed after
a server crash. Delete children before deleting their parent.

The local API also provides `GET /api/sessions/:id/subagents` and
`POST /api/sessions/:id/subagents` (empty object to create, optional `prompt`, or
`sessionId` plus `prompt` to assign an existing child), subject to profile permissions.

## Install as an app

Build and run Sunday in production (`npm run build`, then `npm start`). Open it
at `http://localhost:3000` or through an HTTPS address. In supported desktop
browsers, use the address-bar install button or the browser menu's **Install app**
option. On iPhone/iPad, open Safari and choose **Share → Add to Home Screen**.
Browser installation UI and availability vary; plain HTTP on a remote IP is not a
secure context and will not support service-worker registration.

The installed app opens in its own window and still connects to the same Sunday
server. The minimal service worker does not cache chats, credentials, API responses,
or an offline shell: an active server connection is required. Development mode
does not register a service worker. No additional server or public hosting is needed.
