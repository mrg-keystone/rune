import { app } from "./server.ts";

/**
 * The in-process client demo. `app.backend.fetch` is a drop-in for the global `fetch`:
 * same signature, returns a raw `Response`, accepts relative paths. But every call runs
 * fully in-process — no TCP, no open port — against the exact server pipeline.
 *
 * Run it:
 *   deno run -A examples/in-process-client/main.ts
 *   # or: deno task example
 *
 * Notice there is NO `app.listen()` anywhere, and NO access token — in-process calls are
 * trusted automatically. The same requests over the network would each need a token.
 */

// 1) Relative GET. (Global `fetch` would reject "/users"; the backend resolves it.)
const list = await app.backend.fetch("/users");
console.log("GET /users        →", list.status, await list.json());

// 2) POST with a JSON body — routed through @Body(), just like over the wire.
const created = await app.backend.fetch("/users", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ name: "Bob" }),
});
const bob = await created.json();
console.log("POST /users       →", created.status, bob);

// 3) Path param — fetch the user we just created back by id.
const one = await app.backend.fetch(`/users/${bob.id}`);
console.log(`GET /users/${bob.id}     →`, one.status, await one.json());

// 4) A missing user → the controller throws NotFoundException, and the framework's
//    exception filter turns it into a real 404 — in-process, same as over the wire.
const missing = await app.backend.fetch("/users/999");
console.log("GET /users/999    →", missing.status, await missing.text());

// Tidy up. (We never bound a port, but stop() releases the app's resources.)
await app.stop();
