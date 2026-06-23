import { App, staticFiles } from "fresh";
import { embed } from "@mrg-keystone/rune";
import { api } from "./backend.ts";
import type { State } from "./utils.ts";

export const app = new App<State>()
  .use(staticFiles())
  // One call: token-gated backend at /api/* (conn info forwarded), in-process
  // client on ctx.state.api everywhere else. Register before .fsRoutes().
  .use(embed(api, { at: "/api" }))
  .fsRoutes();
