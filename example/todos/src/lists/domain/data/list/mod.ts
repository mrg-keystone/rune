// Scaffolded once; fill in the bodies. `sync` preserves this file.

import { ListDto } from "@/src/lists/dto/list.ts";

export class List {
  fill(name: string): Promise<List> {
    throw new Error("not implemented");
  }
  save(listDto: ListDto): Promise<void> {
    throw new Error("not implemented");
  }
  toDto(): Promise<ListDto> {
    throw new Error("not implemented");
  }
  load(id: string): Promise<ListDto> {
    throw new Error("not implemented");
  }
  append(taskId: string): Promise<List> {
    throw new Error("not implemented");
  }
}
