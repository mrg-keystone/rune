// Scaffolded once; fill in the bodies. `sync` preserves this file.

import { TaskDto } from "@/src/tasks/dto/task.ts";

export class Task {
  fill(title: string): Promise<Task> {
    throw new Error("not implemented");
  }
  save(taskDto: TaskDto): Promise<void> {
    throw new Error("not implemented");
  }
  toDto(): Promise<TaskDto> {
    throw new Error("not implemented");
  }
  load(id: string): Promise<TaskDto> {
    throw new Error("not implemented");
  }
  markDone(): Promise<Task> {
    throw new Error("not implemented");
  }
}
