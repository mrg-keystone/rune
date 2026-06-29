# user-stories.md — Tasks (a minimal todo backend)

User stories derived from [spec.md](./spec.md). One role:

- **User** — creates and completes their own tasks.

---

## Create tasks

- As a **user**, I want to create a task by submitting a title, so that I can capture something I need to do. ([Goals](./spec.md#goals), [Key flows](./spec.md#key-flows))
- As a **user**, I want a newly created task to start out not done, so that I can tell at a glance it still needs doing. _(done = false)_ ([Key flows](./spec.md#key-flows))

## Complete tasks

- As a **user**, I want to mark a task complete by referencing its id, so that I can track what I've finished. ([Goals](./spec.md#goals), [Key flows](./spec.md#key-flows))
- As a **user**, I want completing a task to record a new state rather than overwrite the old one, so that the task's history is preserved and the latest state is the current one. _(append-only)_ ([The heart of the design](./spec.md#the-heart-of-the-design))

## Read task state

- As a **user**, I want to read a task's current state (title + done), so that I can see whether it's finished. ([Goals](./spec.md#goals))
