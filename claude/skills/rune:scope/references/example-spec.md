# spec.md — Portable Dev Workstation ("my laptop, anywhere")

A desktop client that carries your **portable developer identity** and binds it to
pluggable, per-employer **environments**. Each environment brings its own tools, its
own Claude subscription, its own codebase, and your installed dotfiles. The only thing
your laptop physically holds is your **secrets**, which are injected into an
environment at runtime and never persist on someone else's disk. Inside: a split
**Claude | vim** workspace over the same terminal stack VS Code uses, with persistent
remote sessions.

> Status: scoping draft. Sections marked **[DECIDE]** are open product choices; each
> has a recommended default so build can start. This supersedes the earlier
> "multi-tenant VPS" framing — the product is a *portable client*, not a host.

---

## 1. Product thesis

**The constant is *you*. Everything else is pluggable.**

- Your **laptop** holds almost nothing: a local **secrets keyring** (a `.env`) plus
  the Electron client that is your window into any environment.
- An **environment** is a remote, containerized dev box — typically one per
  employer/context. It provides the **tools/IDE**, the **employer's Claude
  subscription** (logged in on that box), the **codebase**, and **your dotfiles**
  (installed onto it, because they aren't secret).
- On connect, the client **injects your secrets** into the environment ephemerally
  (RAM-only, gone when the box stops) — usable in-session, never written to an
  employer's disk.

So you can sit at one laptop and work in **Employer A's** environment (A's Claude, A's
repo) and **Employer B's** (B's Claude, B's repo) — each isolated, both wearing your
shell + dotfiles, with only your secrets traveling with you.

```
┌─────────────────┬──────────────────────────────┬─────────────────────────────┐
│ SESSIONS        │  Tab bar: [ Workspace ] [ Browser ]                         │
│ 1 acme-plat. ⟳  ├──────────────────────────────┬─────────────────────────────┤
│   wired the …   │   CLAUDE  (left pane)        │   VIM  (right pane)         │
│ 2 billing-api   │   claude TUI in a pty        │   nvim — navigate/edit      │
│   added rate…   │   (employer's subscription)  │   files by hand            │
│ 3 tether-cli    │                              │                            │
└─────────────────┴──────────────────────────────┴─────────────────────────────┘
   Cmd+H → focus Claude   Cmd+L → focus vim   Cmd+B → Browser   click a session to switch

The left **sessions sidebar** (§11.4) lists each box you're plugged into — name, live
working indicator, and what Claude last did — and is the primary way to switch between them.
```

Login is dead simple: an **environment id** input + **Sign in with Google**. Google
identifies *you*; the environment id picks *where you plug in*.

## 2. Goals / Non-goals

**Goals**
- One desktop client; Google sign-in; pick an environment; you're working.
- Per-employer environments, isolated, each with its own Claude subscription +
  codebase + your installed dotfiles.
- **Many environment instances run concurrently on a single host** — the host is a
  fleet of isolated boxes; the gateway multiplexes and supervises them. (The original
  "many tenants share a VPS" goal.)
- **Personal secrets live only on the laptop**, injected ephemerally, never persisted
  on an environment.
- Persistent remote sessions with a precise **attached / detached / stopped** contract.
- Split **Claude | vim** with vim-style focus swap; a browser pane.

**Non-goals (v1)**
- Real-time co-editing (Live Share-style). Shared-folder semantics only if a box is
  deliberately shared.
- CRIU-style process freeze/restore. A stop is a reboot, not a snapshot.
- **In-app per-resource authorization** — perimeter access control is handled by an
  external provider (§9). The environment-id input is just an input.
- Web/browser client (desktop Electron only).
- A full IDE (no LSP/debugger UI, no extension marketplace). vim is the editor.

## 3. The state model (the heart of the design)

Three categories of state, each with a different home and lifecycle. **Only the
secrets are ephemeral; everything else lives on — and persists on — the environment.**

| What | Lives on | Survives a **stop**? | How it gets there |
|------|----------|:---:|-------------------|
| Tools / IDE | environment | ✅ (rebuilt from image) | the environment image |
| **Claude subscription / login** | environment | ✅ | employer provisions it on the box |
| Codebase ("programming folder") | environment volume | ✅ | git / persistent volume |
| Dotfiles / shell config | environment | ✅ | installed from **your dotfiles repo** |
| Claude conversation history | environment volume | ✅ | written by `claude` to `~/.claude` |
| **Personal secrets (`.env`)** | **laptop** | ❌ — re-injected next start | Electron → **tmpfs** in env |

**Why Claude is on the environment, not the laptop:** the employer pays for and
provides the Claude seat; it's logged in on their box. Connecting to Employer A uses
A's Claude; Employer B uses B's. Your laptop holds zero employer credentials.

**Why dotfiles are on the environment, not injected:** they aren't secrets and you use
them in place. They're installed onto each environment (from your dotfiles repo) and
persist there — this is the original "the box has my onboarding dotfiles installed."

**The discipline that makes it safe — dotfiles carry zero secrets.** Config goes in
dotfiles (persist on the env); secrets go in the `.env` (injected, ephemeral). A token
that sneaks into `.zshrc` / `.netrc` / `.aws/credentials` would persist on the employer
box and defeat the whole split. Keep the line clean.

## 4. Session lifecycle — attached / detached / stopped

This is the persistence contract. Three states, precisely:

| State | Environment box | tmux + processes | Injected secrets | What "resume" means |
|-------|:---:|:---:|:---:|---------------------|
| **Attached** | running | running, a client streaming | present | — (you're live) |
| **Detached** (client disconnects) | **running** | **alive** | **present** (box still up) | re-attach to tmux → instant, **zero loss**, same live session |
| **Stopped** (box down = "logged out") | gone | gone | **gone** (re-injected on next start) | fresh box on the persistent disk → files + dotfiles + employer's Claude all back; live processes restart; `claude -r` optional |

- **Detached is the only state that preserves the live session** (vim windows, tabs,
  an in-flight `claude` run) — because nothing was torn down.
- **Stopped** keeps the *disk*, not the *processes*. You come back to your files and a
  logged-in Claude, with a clean shell/vim/claude. There is **no session-save step**:
  the durable state is just the environment's volumes, which persist on their own.
- **`claude -r` is opt-in.** It works after a stop only because conversation history
  lives on the environment volume (persistent), not in the ephemeral secret. Nothing
  auto-resumes; you run it if you want it.
- **No CRIU.** Freezing process memory across a stop is out of scope; a stop is a
  dev-box reboot, not a freeze/thaw.

> "Machine state" = the environment's **disk** (files + dotfiles + Claude history) —
> **not** system-level changes. An `apt install foo` in a running box is gone on the
> next start (system comes from the swappable image). A package you want permanently
> belongs in the environment image.

## 5. Architecture

Three tiers, plus the secrets path. The gateway is the only component that talks to
Docker.

```
  ┌─────────────────────────────────┐
  │  Laptop — Electron client       │   the "secrets keyring + viewport"
  │  - local .env  (secrets only)   │
  │  - Firebase Auth (Google)       │   wss:// (Firebase ID token + secrets push)
  │  - xterm.js × 2 (Claude | vim)  │ ───────────────────────────────────┐
  │  - WebContentsView (browser)    │                                     │
  └─────────────────────────────────┘                                     ▼
                                   ┌──────────────────────────────────────────────┐
                                   │  Host (your VPS for v1)                       │
                                   │  Caddy/Traefik (TLS, auto-HTTPS)              │
                                   │  Gateway (Node/TS)                            │
                                   │   - verify Firebase token (Admin SDK)         │
                                   │   - resolve env id → environment container    │
                                   │   - dockerode: ensure/start; exec → tmux ↔ WS │
                                   │   - write injected secrets to env's tmpfs     │
                                   │   - port-preview proxy (browser pane)         │
                                   │        │ docker.sock                          │
                                   │  ┌─────┴────────────────────────────────────┐ │
                                   │  │ Environment: env-<id>  (per employer)     │ │
                                   │  │  image: tools (node/git/tmux/nvim/claude) │ │  swappable
                                   │  │  Claude: EMPLOYER's subscription on box   │ │  persists on env
                                   │  │  tmux "main": win claude / vim            │ │
                                   │  │  ┌──────────────────────────────────────┐ │ │
                                   │  │  │ volume: code-<id>  → /workspace       │ │ │  persistent
                                   │  │  │ volume: home-<id>  → dotfiles, ~/.claude│ │ │  persistent
                                   │  │  │ tmpfs:  /run/secrets/.env  (injected) │ │ │  EPHEMERAL (RAM)
                                   │  │  └──────────────────────────────────────┘ │ │
                                   │  └───────────────────────────────────────────┘ │
                                   └──────────────────────────────────────────────┘
```

### 5.1 Electron client (the laptop)
- **Main process:** holds the local `.env` (secure storage / `safeStorage`); owns the
  WebSocket; on connect, reads `.env` and **pushes secrets** for tmpfs injection;
  optionally **watches** the file and re-pushes on change (live-sync = "feels like a
  symlink"); the keybinding allowlist (`before-input-event`); manages the
  `WebContentsView` for the browser pane.
- **Renderer:** two `xterm.js` instances + addons (`fit`, `webgl`, `unicode11`,
  `web-links`); Firebase JS SDK auth UI; environment picker; tab bar; splitter; keymap.
- **Preload:** `contextBridge` exposes a minimal, typed IPC surface only.

### 5.2 Gateway (per host) — the always-on server

One privileged Node/TS process per host. It is the **only** component that talks to
Docker (holds `docker.sock`) and is therefore the **infra trust boundary**. Three roles
in one service:

1. **Identity verifier.** The Google sign-in happens **client-side** (Electron runs the
   Firebase/Google OAuth and obtains an ID token). The gateway does *not* run the login
   — it **verifies** the presented token (Firebase Admin SDK). So: *client
   authenticates → gateway authorizes + provisions.*
2. **Container supervisor (the fleet, §5.4).** Creates/starts/stops/reaps `env-<id>`
   containers via `dockerode`.
3. **I/O bridge.** `docker exec` a `tmux attach` and pipe pty ↔ WebSocket.

**Connect sequence** (what happens when a client opens a session):

1. **Verify** the Firebase ID token → establish `uid`. (Bad/no token → reject.)
2. **Resolve** the requested **env id** → an `environments` row.
3. **Provision / start** the container (`dockerode`):
   - first time → create volumes (`code-<id>`, `home-<id>`), create `env-<id>` from the
     image, install dotfiles on first boot (§8);
   - returning → `docker start` if stopped.
4. **Inject secrets** → write the client's pushed `.env` into the env's tmpfs (RAM,
   never disk, §7).
5. **Bridge I/O** → `docker exec` `tmux attach` (`new-session -A`) and pipe pty ↔ WS,
   forwarding `resize`.
6. **Proxy ports** → serve the browser pane's port-preview.

**Lifecycle ops it owns:** `provision` (first-time create), `start` (warm a stopped
env), `stop` (idle reaper → free RAM, volumes persist), `recreate/swap` (new image,
same volumes), `reconcile` (on gateway boot, rebuild expected state from the DB).

One multiplexed WS per session carries both panes (channel per tmux window) + control +
the secrets push. The **port-preview proxy** maps
`https://<host>/p/<env>/<port>/…` → `env-<id>:<port>` over the internal network (no host
port bindings, §9).

### 5.3 Environment (per employer)
- **IDE image (swappable):** Debian/Ubuntu + `node`, `git`, `tmux`, `neovim`, the
  **Claude Code CLI**, runtimes.
- **Employer's Claude** logged in on the box (provisioned by the employer/host).
- **Persistent volumes:** `code-<id>` (the programming folder → `/workspace`) and
  `home-<id>` (dotfiles + `~/.claude` history). These survive stop, reboot, image swap.
- **tmpfs:** `/run/secrets/.env` — your injected secrets, RAM-backed, gone on stop.
- **tmux** session `main` with windows `claude` and `vim`; the gateway execs into this
  container.

### 5.4 The host runs a fleet (one gateway, many environments)

The diagram shows **one** environment; a host runs **N of them concurrently**. The
gateway is the **fleet manager / multiplexer**: it routes each (client, env id) to the
right `env-<id>` container, starts/stops them on demand, and enforces per-env limits.
Nothing global is shared between environments except the kernel, the gateway, and the
proxy — every env has its own container, volumes, tmpfs, Claude login, and tmux.

Same mechanism whether the N environments belong to **one developer** (Employer A + B
both running) or to **different users** on a shared host. See §9 for density.

## 6. Terminal transport protocol

Mirror what code-server / VS Code remote do — a thin framing over one WS:

| Type      | Direction | Payload |
|-----------|-----------|---------|
| `data`    | both      | `{ ch, bytes }` — raw pty I/O for channel `ch` (claude / vim) |
| `resize`  | client→gw | `{ ch, cols, rows }` |
| `open`    | client→gw | `{ ch, window }` — attach a tmux window to a channel |
| `secrets` | client→gw | `{ env }` — push `.env` contents for tmpfs injection (TLS only) |
| `signal`  | client→gw | `{ ch, sig }` — e.g. SIGINT passthrough |
| `ping`/`pong` | both  | heartbeat; drives reconnect/backoff |
| `error`   | gw→client | `{ code, msg }` |
| `activity`| gw→client | `{ session, working, lastAction }` — drives the sessions rail (§11.4); sourced from a Claude Code hook on the box |

- Binary frames for `data`; JSON for control.
- **Reconnect:** client retries with backoff; because the pty lives in tmux, a
  reconnect just re-attaches (the **detached** state) — no lost state; server replays
  tmux's current screen.
- Optional local echo / cursor prediction later (mosh-style); not v1.

## 7. Secrets injection (laptop → environment, ephemeral)

The mechanism behind "my secrets, anywhere, but never persisted on their box":

- The **durable copy lives only in the laptop's local `.env`.** Electron reads it,
  pushes the contents over the (TLS) channel, and the gateway writes them into a
  **tmpfs** mount in the environment, e.g. `/run/secrets/.env` (and/or injects as
  process env for the tmux session).
- **tmpfs is RAM-backed**, so the secret is **present while the box runs** (attached or
  detached) and **destroyed the instant the box stops** — it never touches the VPS
  disk, so seizing the disk yields nothing.
- **"Feels like a symlink":** there is no literal cross-machine symlink. The live feel
  comes from Electron *watching* the local file and re-pushing on change, so edits
  propagate into the running env.
- **Honest scoping:** the gateway transiently relays the plaintext (in transit + RAM)
  to place it in the tmpfs. The guaranteed property is *never persisted to disk*. A
  gateway-blind design (end-to-end encrypted into the container) is a later step, out
  of v1.
- **Trust direction (named, not warned):** if an environment is the employer's infra,
  your injected secrets transiently live in *their* box's RAM while you're connected.
  Trust flows both ways. Acceptable if you trust them — worth knowing because you're
  bringing personal creds into someone else's box.

## 8. Dotfiles / onboarding

Dotfiles are **not secrets** and you use them in place, so they **install onto the
environment and persist there** — not injected.

- Source = **your dotfiles repo** (chezmoi / bare-git), installed onto each environment
  on first boot; persists on the env afterward.
- **Idempotent seed-on-first-run:** if the home volume is empty, install once; on later
  boots the user's files already exist → don't overwrite. A `~/.provisioned` marker
  guards it.
- A **private** dotfiles repo needs a pull token — that token is one of your **injected
  secrets** (or make the repo public). One-time wrinkle, not a blocker.
- Reinforce the discipline from §3: **dotfiles carry zero secrets**; anything sensitive
  lives in the injected `.env`.

## 9. Isolation, hosting & trust

- **One environment container per employer-context**, deterministic name `env-<id>`,
  on an internal Docker network with **no inbound** exposure (gateway proxies all).
- **Resource limits per env:** `--cpus`, `--memory`, `--pids-limit`, `--memory-swap`,
  disk quota on the volumes.
- **Hardening (MVP):** `--cap-drop ALL` (+ only needed caps), `--security-opt
  no-new-privileges`, seccomp default, `userns-remap` (container root ≠ host root);
  writable persistence confined to the mounted volumes + the secrets tmpfs.
- **Stronger-isolation upgrade path:** rootless Docker → **gVisor (`runsc`)** or
  **Kata/Firecracker microVMs**. Ship plain-Docker-hardened first.
- **No in-app authorization layer.** Per the design decision, **perimeter access
  control is handled by an external provider** — whoever reaches the app is trusted.
  The environment-id input is just an input; the environment list is a UX convenience,
  not a security gate.
- **The gateway is the infra trust boundary:** it holds `docker.sock`. It must never
  pass user-controlled strings to a shell; all Docker ops go through `dockerode` with
  fixed, parameterized specs.

### Running many environments on one host (density)

The host is built to pack many isolated environments. The keys:

- **Everything is keyed by env id** — container `env-<id>`, volumes `code-<id>` /
  `home-<id>`, the secrets tmpfs — so instances never collide.
- **No host port bindings.** Dev servers bind *container-internal* ports; the gateway's
  port-preview proxy reaches them over the internal Docker network and namespaces by
  env id (`/p/<env>/<port>/`). Two envs can both run a server on `:3000` with zero
  conflict. The only host-exposed port is the gateway's `443`.
- **Per-env cgroup limits** (`--cpus`, `--memory`, `--pids-limit`) so one env can't
  starve its neighbors.
- **Overcommit + idle reaping.** Most envs sit idle → auto-`stop` idle ones (volumes
  persist, §4), so a host holds far more *registered* envs than *running* ones. Running
  set ≈ active users; the rest cost only disk. RAM is usually the binding constraint:
  rough capacity ≈ (host RAM − overhead) ÷ per-env working set. Optionally cap
  max-concurrent-running with a small queue so the box never thrashes.
- **Isolation** between co-located envs is the container boundary (separate namespaces).
  Stronger per-env host-uid segregation at high density needs per-container `--userns`
  mappings (not the daemon-global remap) — an upgrade, and secondary here since access
  control is handled at the perimeter.

### Who hosts the environments? **[DECIDE — D-host]**
- **You host them** (one box per employer-context on your VPS), loading each employer's
  Claude seat + repo + your dotfiles into the right box. Pragmatic, buildable now —
  **recommended for MVP.**
- **Employers host them**, and the app becomes a *universal client* to externally
  provided environments (protocol-like). The bigger vision; not the MVP.

## 10. Browser pane

- **Default (recommended):** an in-client `WebContentsView` overlay, loading forwarded
  environment ports via the port-preview proxy (preview the app Claude is building) +
  arbitrary URLs. Low latency, native feel; prefer `WebContentsView` over deprecated
  `BrowserView` / `<webview>`.
- **Alternative (heavier, later):** a real browser running *inside* the environment,
  streamed via noVNC/WebRTC — only if server-side cookies/session are required. Out of
  v1 scope.

## 11. UX & interaction model

### 11.1 Layout
- A persistent **sessions sidebar** on the left (the home rail, §11.4), then the content.
- Two panes: **Claude** (left), **vim** (right), resizable splitter.
- Top **tab bar**: `Workspace` (the split) and `Browser`. The **sessions sidebar** is the
  primary switcher between boxes (`Cmd+E` still cycles); the old tab-bar environment
  switcher is folded into the rail.
- Switching to `Browser` overlays a web view across the content area; switching back
  restores the split.

### 11.2 Keymap — and the conflicts you must design around

Inside `claude`'s TUI and inside vim, **almost every key is meaningful — especially
`Tab`.** The client intercepts only a *small allowlist* of chords and forwards
everything else to the pty.

| Action                | Binding (default) | Conflict note / resolution |
|-----------------------|-------------------|----------------------------|
| Focus left (Claude)   | `Cmd+H`           | macOS default = "Hide app". Intercept in main process (`before-input-event` + override the Hide menu role). |
| Focus right (vim)     | `Cmd+L`           | Fine inside Electron (we own it). |
| Toggle Browser tab    | `Cmd+B`           | **Bare `Tab` is NOT viable** — essential in vim and the Claude TUI. Keep a *visible* Browser tab; bind the toggle to `Cmd+B`. |
| Workspace tab         | `Cmd+1`           | — |
| Browser tab           | `Cmd+2`           | mirrors `Cmd+B` |
| Switch environment    | `Cmd+E`           | opens the env switcher |
| Command palette       | `Cmd+K`           | optional |

Rules:
- The renderer registers a **strict allowlist**; every other keystroke (`Tab`, `Esc`,
  `Ctrl+C`, arrows, function keys) goes straight to the focused `xterm` → pty.
- `Cmd+H`/`Cmd+L` are captured in the **main process** and the macOS Hide role is
  overridden so the OS doesn't steal them.
- All chords **rebindable** (keymap JSON).

> The original "press Tab to switch to browser" can't coexist with a working
> vim/Claude TUI. Keep the Browser **tab** + `Cmd+B`; if you want a bare key, use one
> the terminals don't need (e.g. `F12`), never `Tab`.

### 11.3 Focus model
Exactly one pane is active and receives keystrokes (visible border highlight). Click to
focus. Resize (`Cmd+drag` splitter or window resize) triggers `fit` + a pty `resize`.

### 11.4 Sessions sidebar (the client's home rail)

A persistent **left rail** lists every **session** you're plugged into — the primary
switcher (it supersedes the tab-bar environment switcher; `Cmd+E` still cycles). One row
per session:

- a **numbered slot** (1, 2, 3…) — its position in the rail;
- a **working indicator** — a live pulse while Claude is actively working in that box,
  otherwise a state dot (attached / detached / stopped);
- the **session name**, which **defaults to the folder that is the parent of the git root**
  of that box's workspace (renameable);
- a one-line **summary of the last thing Claude did** in that session (wraps to multiple
  lines), so you can scan all your boxes and see which need attention.

Clicking a row switches to that session. **What a "session" is:** a live attachment to an
environment — the env's box + the Claude/vim split + the active repo. **In v1 it is 1:1
with an environment** (one box, one workspace); the rail is the environment list (§5.4/§12)
wearing its workspace name and live activity. The **working state** and **last-Claude-action
summary** are **runtime, derived** (not persisted in the control plane): a **Claude Code hook**
on the box (a Stop / activity event) reports `{ working, lastAction }`, which the gateway
relays to the client over the `activity` message (§6) to drive the rail. (Settled — §16
[D-session], [D-activity].)

## 12. Control-plane data model

Small SQLite (→ Postgres if it grows). **Stores no secrets and no Claude
credentials** — those live on the laptop and the environment respectively.

```
users(uid PK, email, created_at)

environments(id PK,                  -- the env id the user types/picks
             label,                  -- e.g. "Employer A"
             host,                   -- where it runs (your VPS for v1)
             ide_image,              -- swappable tooling image
             container_id,           -- current container (changes on recreate/swap)
             code_volume,            -- persistent /workspace
             home_volume,            -- persistent dotfiles + ~/.claude history
             dotfiles_repo,          -- source for onboarding (non-secret config)
             status, last_active,
             cpu_limit, mem_limit, pids_limit, disk_limit)

user_environments(uid FK, env_id FK) -- a user's saved list (UX, not an ACL — §9)

audit(id, uid, env_id, action, ts, meta)  -- connect/start/stop/swap/reconcile
```

- No `secrets` table: secrets live only in the laptop `.env`, injected to tmpfs.
- No `credentials` / `usage` table: Claude is the **environment's** (employer's),
  logged in on the box; there's nothing to meter here.
- `code_volume` / `home_volume` are **stable**; `ide_image` / `container_id` change on
  an image swap or recreate.
- **A single host runs many `environments` rows concurrently** (the fleet, §5.4/§9).
  Envs are independent units — assignable to one user (multi-employer) or several
  (shared host) via `user_environments`; the schema is identical either way.

## 13. Tech stack

- **Client:** Electron + TypeScript, xterm.js (+addons), Firebase JS SDK,
  `WebContentsView`, secure storage for the local `.env`, esbuild/vite,
  electron-builder.
- **Gateway:** Node + TypeScript, `ws`, Firebase Admin SDK, `dockerode`, Caddy/Traefik
  (TLS), SQLite/Postgres.
- **Environment image:** Debian/Ubuntu, node, git, tmux, neovim, Claude Code CLI.
- **Infra:** Docker + per-env persistent volumes + per-env tmpfs for secrets; one host
  (VPS) for v1; Docker Compose for gateway + proxy.

## 14. Milestones

| # | Deliverable |
|---|-------------|
| **M0** | Walking skeleton: Electron + 1 xterm ↔ gateway WS ↔ an env container's tmux shell. No auth. Proves the transport. |
| **M1** | Firebase Google sign-in + **environment-id → attach**; gateway verifies token; container started/created lazily. |
| **M2** | Split **Claude \| vim** layout; tmux windows; `Cmd+H`/`Cmd+L` focus swap with the strict keybinding allowlist. |
| **M3** | **Lifecycle:** persistent `code`/`home` volumes; **detached** (reconnect, zero loss) vs **stopped** (fresh box on persistent disk). |
| **M4** | **Secrets injection:** push local `.env` → tmpfs in the env; verify it's gone on stop, present on detach; optional file-watch live-sync (§7). |
| **M5** | **Dotfiles install-from-repo** (idempotent, §8); employer-Claude already-logged-in flow; `claude -r` resume works off the persistent volume. |
| **M6** | Browser pane: `WebContentsView` + port-preview proxy + tab bar + `Cmd+B`. |
| **M7** | **Multi-environment switching** (Employer A ↔ B), each isolated with its own Claude/code; env switcher + `Cmd+E`. |
| **M7.5** | **Density on one host:** N concurrent `env-<id>` instances; per-env limits; no port collisions (proxy namespacing); idle reaper; overcommit (registered ≫ running). |
| **M8** | Hardening: limits, userns/seccomp/cap-drop, idle reaper, reconciler, metrics/logs. |

## 15. Key risks & mitigations

1. **Keybinding collisions** (`Tab`, `Cmd+H`) breaking the terminals → strict allowlist
   + main-process interception + rebindable keymap (§11.2). *Highest UX risk.*
2. **A secret leaking onto an employer's disk** → enforce the **dotfiles-carry-no-
   secrets** rule (§3/§8); secrets only ever go to tmpfs (§7), never a volume.
3. **Container escape / gateway compromise** (§9) → harden runtime; gateway is the only
   `docker.sock` holder; no shell-string interpolation; gVisor upgrade path.
4. **Terminal latency** over WAN → keep gateway region-close; binary frames; optional
   cursor prediction later.
5. **Reboot/stop recovery** → reconciler rebuilds from DB; durable state on volumes; a
   stop is a reboot (live processes restart, §4) — set the expectation in the UX.

## 16. Decisions to confirm

- **[D-host] Who hosts environments** — **you host on your VPS (recommended MVP)** vs
  employers host (universal-client future) (§9).
- **[D2] Browser pane** — in-client WebContentsView (**default**) vs streamed remote
  browser (§10).
- **[D3] Target OS** — macOS-only (the `Cmd` keys suggest it) or cross-platform (map
  `Cmd`→`Ctrl`). Default: **macOS first, abstract the keymap.**
- **[D4] Isolation tier** — hardened Docker (**default v1**) vs gVisor/microVM (§9).
- **[D5] Dotfiles source** — your single dotfiles repo (**default**) vs per-env
  variations (§8).
- **[D-density] Overcommit policy** — idle-reap + a max-concurrent-running cap
  (**default**) vs always-on environments. Sets how many fit per host (§9).
- **[D-session] Session ↔ environment cardinality** — **RESOLVED: 1:1 in v1** (one session
  per box, named by its workspace folder). Many-sessions-per-box (the rail becomes a tree)
  is a later upgrade (§11.4).
- **[D-activity] Sourcing per-session activity** — **RESOLVED: Claude Code hooks.** A hook
  on the box (Stop / activity event) reports `{ working, lastAction }`; the gateway relays it
  to the client (the `activity` message, §6) to drive the rail — structured, no TUI scraping.
  (Alternatives weighed: parsing the `claude` TUI/pty stream; a status file the box writes.)
  (§11.4).

**Settled this round:** Claude lives on the **environment** (employer's subscription),
not the laptop; **dotfiles install onto the environment** (non-secret); only **secrets**
are laptop-held and injected ephemerally; **no in-app authorization** (perimeter handled
externally); persistence contract = **attached / detached / stopped**, no CRIU. The
**sessions sidebar** is the primary switcher; a **session is 1:1 with an environment** in v1;
per-session **working state + last action** come from a **Claude Code hook** on the box,
relayed to the client.

## 17. Verdict

Feasible with well-understood building blocks (xterm.js + node-pty + tmux + Docker +
Firebase + Electron). The design's power is in *where state lives*: the laptop is a thin
**secrets keyring + viewport**, each **environment** carries its own tools, Claude, code,
and your dotfiles, and the only thing that crosses the boundary at runtime is your
secrets — into RAM, never to disk. That removes whole classes of work (no billing layer,
no credential store, no in-app ACLs) and gives a clean **attached / detached / stopped**
contract with no CRIU. The one thing to nail early is the **keybinding model** (§11.2)
so the terminals stay usable. Build **M0** to de-risk the transport, then **M4** to prove
the ephemeral-secrets injection — the mechanism the whole "my laptop, anywhere" promise
rests on.
