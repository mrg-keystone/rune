import { createDefine } from "fresh";
import type { KeepState } from "@mrg-keystone/rune";

// This specifies the type of "ctx.state" which is used to share
// data among middlewares, layouts and routes. KeepState contributes
// `api` — the in-process client set by `embed` in main.ts.
export interface State extends KeepState {
  shared: string;
}

export const define = createDefine<State>();
