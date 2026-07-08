# Taskline — product spec

## Users

- **Member** — a person tracking their own work items.
- **Admin** — a workspace owner who manages members and sees everything.

## Goals

1. A member captures a task in under five seconds and trusts it won't be lost.
2. A member always sees what's open, what's done, and what's overdue at a glance.
3. An admin can onboard a new member without touching a database.
4. The system never silently loses or duplicates a task, even on flaky networks.

## The heart

Taskline is a single shared list per workspace. Every task has a title, a done flag,
and an owner. Completing a task is an explicit, auditable act — tasks are never
deleted, only completed or reassigned. The list loads current-state instantly and
history is append-only underneath.

## Flows

### Capture (member)
Member types a title, presses enter, the task appears at the top of the open list
immediately (optimistic), and is durably stored. On failure the task row shows an
error state and offers retry; it never vanishes.

### Complete (member)
Member checks a task; it moves to the done section with a timestamp. Unchecking
within 10 seconds undoes it (grace window); after that, completion is history.

### Review (member)
Member filters the list: open / done / all, paged 25 at a time. Overdue tasks
(open > 7 days) get a badge. An empty open list shows a "all clear" state, not a blank.

### Onboard (admin)
Admin enters a new member's email; the member gets an invite link; until accepted,
the member row shows "invited" state. Re-sending is idempotent.

### Reassign (admin)
Admin moves a task between members; the task keeps its history and shows
"reassigned by <admin>" in its detail view.

## Milestones

- **M1 — capture + review**: capture, list with filters/paging, empty states.
- **M2 — completion**: complete with grace-window undo, done section, overdue badges.
- **M3 — workspace**: admin onboarding with invites, reassignment with audit trail.
