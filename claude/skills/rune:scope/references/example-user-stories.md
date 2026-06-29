# user-stories.md — Portable Dev Workstation

User stories derived from [spec.md](./spec.md). Two roles:

- **Developer** — the person carrying their portable identity from box to box.
- **Operator** — whoever runs the host (may be the same person, or an employer).

---

## Sign in & connect

- As a **developer**, I want to sign in with Google, so that I don't manage another password.
- As a **developer**, I want to type an environment id on the login screen, so that I choose which box I plug into.
- As a **developer**, I want to land in a working remote box right after sign-in, so that I can start without setup.

## The workspace (Claude | vim)

- As a **developer**, I want Claude on the left and vim on the right, so that I can drive the AI and hand-edit files side by side.
- As a **developer**, I want to swap focus with `Cmd+H` / `Cmd+L`, so that I move between panes without the mouse.
- As a **developer**, I want every other key (including `Tab`) to reach the terminal, so that Claude's TUI and vim behave normally.
- As a **developer**, I want the remote terminal to feel local, so that latency doesn't get in my way.
- As a **developer**, I want to rebind the shortcuts, so that they fit my habits.

## Sessions sidebar

- As a **developer**, I want a left rail listing every session (box) I'm plugged into, so that I see all my work in one place.
- As a **developer**, I want each session named after its project folder (the parent of the git root), so that I recognize them at a glance.
- As a **developer**, I want a live working indicator per session, so that I know when Claude is busy in a box I'm not currently looking at.
- As a **developer**, I want a one-line summary of the last thing Claude did in each session, so that I know which boxes need my attention.
- As a **developer**, I want to switch sessions by clicking a row in the rail, so that I jump between boxes without a menu.

## Browser pane

- As a **developer**, I want a browser tab (`Cmd+B`), so that I can read docs without leaving the window.
- As a **developer**, I want to preview a dev server running in my environment, so that I can see my work live.

## Sessions & persistence

- As a **developer**, I want to close my laptop and reconnect with my session still running, so that long tasks keep going. _(detached)_
- As a **developer**, I want a stopped box to come back with my files and login intact, so that I pick up where I left off. _(stopped)_
- As a **developer**, I want to optionally resume my last Claude conversation with `claude -r`, so that I decide whether to continue or start fresh.

## Secrets (portable identity)

- As a **developer**, I want my personal secrets to live only on my laptop, so that they never persist on an employer's machine.
- As a **developer**, I want my secrets injected into whatever box I connect to, so that my tools work everywhere.
- As a **developer**, I want my secrets to vanish when the box stops, so that nothing sensitive is left behind.
- As a **developer**, I want edits to my local `.env` to reflect in the running box, so that I don't reconnect just to update a secret.

## Dotfiles

- As a **developer**, I want my dotfiles installed on each environment, so that my shell and editor feel like home everywhere.
- As a **developer**, I want my customizations kept across reconnects and image swaps, so that I set them up once.

## Working for multiple employers

- As a **developer**, I want a separate environment per employer, each with its own Claude and codebase, so that work stays isolated.
- As a **developer**, I want to switch environments with `Cmd+E`, so that I can move between jobs in one app.
- As a **developer**, I want each environment to use the employer's Claude subscription, so that I'm not paying or mixing accounts.

## Running the host (operator)

- As an **operator**, I want one server that verifies the user and provisions containers, so that connecting is automatic.
- As an **operator**, I want environments created on first connect and reused after, so that setup is hands-off.
- As an **operator**, I want idle environments stopped automatically, so that I can host more on one machine.
- As an **operator**, I want many environments on one host with no port conflicts, so that density stays high.
- As an **operator**, I want per-environment CPU/RAM/pid limits, so that one user can't starve the others.
- As an **operator**, I want state recovered after a reboot, so that environments come back as expected.

## Security posture (operator)

- As an **operator**, I want access gated at the perimeter by an external provider, so that I don't build in-app auth.
- As an **operator**, I want containers hardened (cap-drop, seccomp, userns), so that environments stay isolated.
