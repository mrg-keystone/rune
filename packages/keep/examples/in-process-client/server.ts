import "reflect-metadata";
import { bootstrapServer } from "@mrg-keystone/keep";
import { AppModule } from "./users.ts";

/**
 * Bootstrap once and export the result. `bootstrapServer` only *initializes* the app —
 * it does NOT call `listen()`, so no port is bound here. That means `app.backend` is
 * usable the moment this module is imported, from anywhere in your process.
 *
 * This is the "server.ts / elsewhere.ts" pattern: define the app in one place, then
 * import `app` and call `app.backend.fetch(...)` wherever you need to talk to your own
 * API in-process (SSR routes, background jobs, scripts, tests).
 */
export const app = await bootstrapServer("examples-api", AppModule, {
  swagger: false,
});
