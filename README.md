# Sunday

Sunday is a local AI chat app built with Node.js, Preact, and Vite. Chat with agents, manage repositories and files, and explore design previews for future features.

## Get started

Requires Git, npm, and Node.js 22.19 or later.

Install Sunday:

```sh
curl -fsSL https://raw.githubusercontent.com/CorneliusTantius/sunday/main/install.sh | sh
cd ~/sunday/sunday
npm start
```

Or run an existing checkout in development:

```sh
npm install
npm run dev
```

Open <http://localhost:3000>. In **Settings**, connect an AI provider and choose a model. To build and run production mode, use `npm run build` followed by `npm start`.

## Features

- Streaming AI chat with reusable agents, personas, and optional repository tools.
- Child agents with separate histories and isolated repository workspaces.
- Repository browsing, Git status, pull, and file editing.
- UI previews for scheduled jobs, Socials (including planned Slack and Gmail integrations), and a personal financial tracker. These previews do not connect services or save jobs or financial data.

## Data and privacy

Sunday stores settings, provider credentials, and chat sessions under `~/sunday/data/`. Source repositories are in `~/sunday/workspace/repos`; agent workspaces are in `~/sunday/workspace-agents/`.

Provider credentials are stored as plaintext in a separate owner-only file; they are not returned by settings endpoints or saved in browser storage. The server listens only on loopback and has no user login. Keep access private. For remote access, use a private network such as Tailscale Serve—do not expose Sunday to the public internet.

## Run as a service

To install the per-user systemd service and health check:

```sh
./install-systemctl.sh
systemctl --user status sunday.service
```

## Checks

```sh
npm test
npm run build
```
