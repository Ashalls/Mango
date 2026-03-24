<p align="center">
  <img src="IconFull.png" alt="Mango" width="280">
</p>

<p align="center">
  <strong>An AI-native MongoDB desktop client — query, explore, and manage your databases with Claude built in.</strong>
</p>

---

## How to install

Download the latest installer from [**GitHub Releases**](https://github.com/Ashalls/Mango/releases/latest) — grab the `.exe` file and run it. That's it.

Mango will **automatically update itself** when new versions are published. Updates download in the background and install on next launch.

> **Prerequisite:** You need [Claude Code CLI](https://claude.ai/claude-code) installed and available on your PATH for the AI chat features.

---

## What is Mango?

Mango is an **AI-native MongoDB client** — a desktop app that combines a full-featured MongoDB IDE with an embedded Claude AI assistant that can directly query and modify your databases.

Instead of switching between a database GUI, documentation, and an AI chat, Mango gives you everything in one place. Ask Claude to write aggregation pipelines, explain query results, migrate data between collections, or perform complex operations — and it executes them directly against your connected databases through a built-in MCP server.

## Features

- **Visual MongoDB explorer** — browse connections, databases, and collections in a tree sidebar
- **Document viewer & editor** — view, edit, and manage documents with Monaco Editor and AG Grid
- **Query builder** — construct find queries and aggregation pipelines with filter/sort/projection controls
- **Embedded Claude AI** — chat with Claude directly in the app; it can read and write to your databases
- **MCP server** — exposes 19+ MongoDB tools so Claude (and external Claude Code sessions) can operate on your data
- **Per-database access controls** — configure which databases Claude can read or write to, per connection
- **Data export/import** — export collections to JSON/CSV, import from files
- **Migration tools** — move data between databases and collections
- **Operation changelog** — audit trail of all write operations performed through the app
- **Auto-updater** — seamless updates via GitHub Releases
- **Dark/light theme** — persistent theme preference

## Tech stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 35 |
| Frontend | React 19, TypeScript, Tailwind CSS 4, shadcn/ui |
| State | Zustand |
| IPC | tRPC (type-safe, via electron-trpc) |
| Database | MongoDB Driver 6 |
| AI | Claude Agent SDK (uses your Claude Code subscription) |
| MCP | Model Context Protocol SDK over HTTP |
| Build | electron-vite, electron-builder |

## Building from source

```bash
git clone https://github.com/Ashalls/Mango.git
cd Mango
pnpm install
pnpm dev
```

Requires [Node.js](https://nodejs.org/) (v18+), [pnpm](https://pnpm.io/), and [Claude Code CLI](https://claude.ai/claude-code) on your PATH.

To build the installer:

```bash
pnpm dist:win
```

## How it works

Mango is an Electron app with a React frontend and a Node.js main process that manages MongoDB connections. The frontend communicates with the main process over tRPC via Electron IPC.

The AI integration works through a built-in [MCP server](https://modelcontextprotocol.io/) running on `localhost:27088`. When you chat with Claude, the app uses the Claude Agent SDK to create a session that connects to this MCP server, giving Claude access to your databases through structured tools (find, aggregate, insert, update, delete, etc.). Access controls ensure Claude only operates within the permissions you've configured.

Connection strings are encrypted at rest using Electron's safeStorage API and stored in `~/.mango/connections.json`.

## Project structure

```
Mango/
  src/
    main/             — Electron main process, tRPC routers, MCP server
    renderer/         — React frontend (components, stores, styles)
    preload/          — Electron context bridge
    shared/           — Shared types and constants
  resources/          — App icons, splash screen
  electron.vite.config.ts
  electron-builder.yml
```

## Contributing

Contributions are welcome! If you find a bug or have an idea, [open an issue](https://github.com/Ashalls/Mango/issues) or send a pull request.

## License

See [LICENSE](LICENSE) for details.

---

<p align="center">
  Built with Claude
</p>
