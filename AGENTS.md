# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

tmux-mobile is a mobile-first web interface for tmux, distributed as an npm package (`npx tmux-mobile`). It connects to tmux sessions over a cloudflared tunnel, letting you control tmux from a phone browser via QR code. Unlike generic web terminals, it is purpose-built for tmux with touch-friendly UI for session/window/pane management.

## Commands

```bash
npm run dev              # Start both backend (tsx watch) and frontend (vite) concurrently
npm run dev:backend      # Backend only with hot-reload (tsx watch)
npm run dev:frontend     # Frontend only (vite dev server, port 5173)
npm run build            # Build both frontend and backend
npm run typecheck        # Typecheck both tsconfig.backend.json and tsconfig.frontend.json
npm test                 # Run all vitest unit/integration tests
npm run test:watch       # Run vitest in watch mode
npx vitest run tests/backend/parser.test.ts  # Run a single test file
npm run test:smoke       # Smoke test against real tmux (requires tmux installed)
npm run test:e2e         # Build + run Playwright e2e tests
```

## Git Workflow (Default)

- By default, do feature development in a dedicated git worktree, not in the primary checkout.
- Keep the primary checkout on `main` for syncing, quick verification, and creating new worktrees.
- Only work directly in the primary checkout when explicitly requested.
- Feature worktrees should be created/rebased from the latest `origin/main` unless explicitly instructed otherwise.

### Naming convention

- Branch: `feat/issue-<number>-<short-kebab-scope>`
- Worktree path: `.worktrees/issue-<number>-<short-kebab-scope>`

## Architecture

### Two-process dev setup
- Backend: Express + node-pty + ws on port 8767
- Frontend: Vite + React on port 5173, proxies `/ws` and `/api` to backend

### Backend (`src/backend/`)
- **cli.ts** — Entry point. Parses args (yargs), wires dependencies, starts server + cloudflared tunnel, prints QR code.
- **server.ts** — `createTmuxMobileServer()` factory. Express serves static frontend + `/api/config`. Two WebSocket servers on the same HTTP server:
  - `/ws/control` — JSON control plane (auth, tmux mutations, state sync)
  - `/ws/terminal` — Binary data plane (xterm.js ↔ tmux PTY I/O, plus resize messages)
- **tmux/** — `TmuxGateway` interface + `TmuxCliExecutor` implementation. Executes tmux commands via `execFile` with tab-delimited format strings. `parser.ts` parses output. `types.ts` has `buildSnapshot()` which assembles full state tree.
- **pty/** — `PtyFactory`/`PtyProcess` interfaces + `NodePtyFactory` adapter. `TerminalRuntime` manages the tmux attach lifecycle (spawns `tmux attach-session -t <name>`).
- **state/state-monitor.ts** — Polls tmux state every 2.5s, diffs against previous, broadcasts changes to control plane clients.
- **auth/auth-service.ts** — Token + optional password auth. Token is auto-generated per server start and embedded in the URL.
- **cloudflared/manager.ts** — Spawns `cloudflared tunnel`, parses public URL from output.

### Frontend (`src/frontend/`)
- **App.tsx** — Single monolithic React component. Manages xterm.js Terminal instance, two WebSocket connections (control + terminal), tmux state, drawer UI, toolbar, compose input, scrollback viewer, auth flow.
- **types/protocol.ts** — Shared protocol types (duplicated from backend, kept in sync manually).
- Vite config roots at `src/frontend/`, builds to `dist/frontend/`.

### Shared Protocol (`src/backend/types/protocol.ts`)
- `ControlClientMessage` — Union type for all client→server control messages (auth, session/window/pane operations, compose)
- `ControlServerMessage` — Union type for all server→client control messages (auth result, state updates, scrollback, errors)
- Tmux state types: `TmuxStateSnapshot` > `TmuxSessionState` > `TmuxWindowState` > `TmuxPaneState`

### Testing

NON TRIVIAL CHANGES SHOULD BE DONE WITH TDD - first write tests, then see then red, then implement, then green.

- **tests/harness/** — `FakeTmuxGateway` and `FakePtyFactory` for unit/integration tests (in-memory, no real tmux)
- **tests/backend/** — Unit tests for parser, state monitor, terminal runtime, env utils
- **tests/integration/** — Server integration tests using supertest + real WebSocket clients against `createTmuxMobileServer` with fakes
- **tests/smoke/** — Real tmux smoke test (needs `REAL_TMUX_SMOKE=1` env var and tmux installed)
- **tests/e2e/** — Playwright browser tests against built app with fake tmux server

### Security
See `SECURITY.md` for the full threat model, auth mechanism, and known weaknesses. Key points for contributors:
- Auth gates both WebSocket endpoints independently; changes to `server.ts` or `auth-service.ts` must preserve this.
- tmux commands use `execFile` argument arrays (not shell strings) to prevent injection — keep it that way.
- Session names are shell-quoted in PTY spawn paths (`node-pty-adapter.ts`).
- Security-sensitive files are listed in `SECURITY.md § Maintenance Guide`.

### Key env vars
- `TMUX_MOBILE_DEBUG_LOG` — Path for debug log file
- `TMUX_MOBILE_SOCKET_NAME` / `TMUX_MOBILE_SOCKET_PATH` — Custom tmux socket (useful for testing isolation)
- `TMUX_MOBILE_TRACE_TMUX=1` — Log all tmux CLI invocations

### Reference: `porterminal/`
The `porterminal/` directory is a clone of the original inspiration project (Python + TypeScript generic terminal). It's reference material only — not part of the build or tests.

### Personal dev preview tunnel (per-machine)

Developers on this machine can run a second tmux-mobile instance behind a Cloudflare **named** tunnel, separate from the production setup. This lets you test a feature branch on a phone before merging without touching prod.

The pieces (paths live in the developer's home, not in this repo):

- **systemd user service** `tmux-mobile-preview.service` — runs the preview backend on a local port (default `8768`, separate from prod's `8767`).
- **wrapper script** `~/.local/bin/tmux-mobile-preview` — invokes `node <SRC>/dist/backend/cli.js` with `--no-tunnel` so the named tunnel can route to it instead of starting its own quick tunnel.
- **env file** `~/.config/tmux-mobile/preview.env` — sets `TMUX_MOBILE_SRC` (the checkout or worktree to serve), `TMUX_MOBILE_PREVIEW_PORT`, and `TMUX_MOBILE_URL_FILE`. Leave `TMUX_MOBILE_TOKEN` / `TMUX_MOBILE_PASSWORD` empty to let the server regenerate them on each start.
- **Cloudflared named tunnel** — a single cloudflared process serves both the prod hostname and the dev hostname; both are configured in the per-host `~/.cloudflared/` config and DNS. The dev hostname resolves to the preview port via the tunnel ingress rule.
- **state file** `~/.local/state/tmux-mobile/preview.url` — written by the preview process on each start. Contains the current `local=`, `tunnel=`, and `password=` lines for the dev URL. Read this file after a restart to grab the new token and password — do **not** check the live hostnames, tokens, or passwords into git.

To point the preview at a feature branch / worktree:

```bash
npm run build                                    # build the worktree you want to serve
# edit ~/.config/tmux-mobile/preview.env and set TMUX_MOBILE_SRC to that path
systemctl --user restart tmux-mobile-preview
cat ~/.local/state/tmux-mobile/preview.url       # new tunnel URL + token + password
```

Keep the actual hostname, tokens, and passwords out of this file and out of commit messages — they are per-machine secrets.
