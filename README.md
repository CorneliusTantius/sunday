# Sunday

A local Node.js + Vite chat app using the pi AI SDK (`@earendil-works/pi-ai`, the current package name). Plain text streaming chat only: no agent loop, tools, or tool execution.

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

`PORT=3001 npm run dev` changes the port. The server binds only to loopback; this is a single-user local app, not a public deployment with user authentication.

## Storage

- `~/sunday/data/settings.json`: selected provider, authorization mode, default model/thinking level, and a stable installation UUID required by OpenAI sign-in.
- `~/sunday/data/auth.json`: provider API keys and ChatGPT OAuth credentials (`openai-chatgpt`), stored separately so connecting one provider does not overwrite another. OAuth refresh is handled by pi and saved here.

Files are written atomically with owner-only permissions (0600). Secrets are stored as plaintext on disk, not encrypted. They are never returned by settings endpoints or stored in browser localStorage. An `OPENAI_API_KEY` environment variable can also supply API authorization.

Chat sessions persist in `~/sunday/data/sessions/<session-id>.json` and appear in the sidebar. Reload restores the last opened session; New chat creates a separate session without deleting previous chats. Stop cancels the response and saves any generated partial text.

The default launch working directory is `~/sunday/workspace`, created automatically. This does not enable filesystem tools or tool calls. The interface uses neutral Void (`#090B10`), Surface (`#11151D`), Elevated (`#1A202B`), and Steel (`#303846`) layers, with cyan actions, blue selection, violet branding, magenta destructive actions, lime connection status, and amber warnings.

## Checks

`npm test` checks session persistence, independent provider credentials, connected-only model catalogs, stable installation identity, and that OAuth mode cannot fall back to an API key. `npm run build` checks the Vite production build. Live OpenAI requests and OAuth require your credentials and account access.
