# Tasks — a minimal todo backend

## Product thesis
A tiny task-tracking service: create tasks and mark them complete. The smallest
useful slice of a todo app, used to exercise the rune pipeline end to end.

## Users (roles)
- **User** — creates and completes their own tasks.

## Goals
- Create a task from a title.
- Mark a task complete.
- Read a task's current state (title + done).

## Non-goals (v1)
- No editing a task's title after creation.
- No deletion.
- No sharing across users.

## The heart of the design
Task state is **append-only history**: completing a task records a new state rather
than overwriting the old one — the latest state is the current one.

## Key flows
- **Create** — the user submits a title → a task is persisted with a fresh id and
  `done = false`.
- **Complete** — the user references a task by id → it loads, is marked done, and is
  persisted.

## Data / entities
- `task` `{ id, title, done }` — a single todo item.

## Tech stack
- rune backend on the keep runtime; an embedded datastore behind the `db` service.

## Milestones
- **M0** — create + complete a task, persisted end to end.

## Verdict
Buildable with known parts. The one thing to nail is the append-only state model.
