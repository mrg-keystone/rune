// Scaffolded once; fill in the bodies. `sync` preserves this file.

import { TaskDto } from "@/src/tasks/dto/task.ts";

export class Task {
  fill(title: string): Task {
    throw new Error("not implemented");
  }
  save(taskDto: TaskDto): void {
    throw new Error("not implemented");
  }
  toDto(): TaskDto {
    throw new Error("not implemented");
  }
  load(id: string): TaskDto {
    throw new Error("not implemented");
  }
  markDone(): Task {
    throw new Error("not implemented");
  }
}
