import { createDefine } from "fresh";
import type { BackendClient } from "@mrg-keystone/danet";

// This specifies the type of "ctx.state" which is used to share
// data among middlewares, layouts and routes.
export interface State {
  shared: string;
  // In-process Danet client (set by middleware in main.ts): call the API with no token.
  api: BackendClient;
}

export const define = createDefine<State>();
