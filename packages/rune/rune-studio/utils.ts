import { createDefine } from "fresh";

// The type of "ctx.state" shared among middleware, layouts and routes.
// (No per-request state needed yet.)
export type State = Record<string | symbol, unknown>;

export const define = createDefine<State>();
