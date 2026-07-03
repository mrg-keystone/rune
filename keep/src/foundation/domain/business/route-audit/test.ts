import "#reflect-metadata";
import { assertEquals } from "#assert";
import { Controller, Get, Module, Post } from "#danet/core";
import { Public } from "@foundation/domain/business/public-route/mod.ts";
import { Grant } from "@foundation/domain/business/grants/mod.ts";
import { LoggedIn } from "@foundation/domain/business/grants/mod.ts";
import {
  auditRoutes,
  openRoutes,
  type RouteAuditEntry,
  warnOpenRoutes,
} from "./mod.ts";

@Controller("things")
class ThingsController {
  @Public()
  @Get()
  list() {}

  // undecorated → open (closed-unless-`*`)
  @Post("create")
  create() {}

  @Grant("admin")
  @Post(":id/edit")
  edit() {}

  @LoggedIn("monsterrg.com")
  @Grant("staff")
  @Post(":id/archive")
  archive() {}

  // a plain helper (no HTTP verb) must not be mistaken for a route
  helper() {}
}

@LoggedIn("monsterrg.com")
@Controller("scoped")
class ScopedController {
  // inherits the class-level @LoggedIn → loggedin, not open
  @Get()
  read() {}
}

@Module({ controllers: [ThingsController, ScopedController] })
class ThingsModule {}

const entry = (rows: RouteAuditEntry[], handler: string) =>
  rows.find((r) => r.handler === handler)!;

Deno.test("auditRoutes classifies each posture and skips non-route helpers", () => {
  const rows = auditRoutes([ThingsModule]);
  // 5 routes (list, create, edit, archive, read) — helper() has no HTTP verb.
  assertEquals(rows.length, 5);
  assertEquals(rows.some((r) => r.handler === "helper"), false);

  assertEquals(entry(rows, "list").posture, "public");
  assertEquals(entry(rows, "create").posture, "open");
  assertEquals(entry(rows, "edit").posture, "grant");
  assertEquals(entry(rows, "archive").posture, "grant+loggedin");
  // class-level @LoggedIn is honored just like the guard reads it.
  assertEquals(entry(rows, "read").posture, "loggedin");
});

Deno.test("auditRoutes joins controller base + handler route", () => {
  const rows = auditRoutes([ThingsModule]);
  assertEquals(entry(rows, "create").route, "/things/create");
  assertEquals(entry(rows, "create").method, "POST");
  assertEquals(entry(rows, "list").route, "/things");
});

Deno.test("openRoutes returns only the undecorated routes", () => {
  const open = openRoutes([ThingsModule]);
  assertEquals(open.map((r) => r.handler), ["create"]);
});

Deno.test("warnOpenRoutes emits one aggregate line naming the bare route", () => {
  const msgs: string[] = [];
  const open = warnOpenRoutes([ThingsModule], {
    appName: "demo",
    honorSkeleton: true,
    warn: (m) => msgs.push(m),
  });
  assertEquals(open.length, 1);
  assertEquals(msgs.length, 1);
  // names the route and the skeleton-only reachability
  assertEquals(msgs[0].includes("POST /things/create"), true);
  assertEquals(msgs[0].includes("ThingsController.create"), true);
  assertEquals(msgs[0].includes("`*` universal grant"), true);
});

Deno.test("warnOpenRoutes wording flips under honorSkeleton:false", () => {
  const msgs: string[] = [];
  warnOpenRoutes([ThingsModule], {
    appName: "infra",
    honorSkeleton: false,
    warn: (m) => msgs.push(m),
  });
  assertEquals(msgs[0].includes("reachable by no caller"), true);
});

Deno.test("warnOpenRoutes is silent when every route is decorated", () => {
  @Controller("safe")
  class SafeController {
    @Public()
    @Get()
    ping() {}

    @Grant("admin")
    @Post()
    act() {}
  }
  @Module({ controllers: [SafeController] })
  class SafeModule {}

  const msgs: string[] = [];
  const open = warnOpenRoutes([SafeModule], {
    appName: "demo",
    honorSkeleton: true,
    warn: (m) => msgs.push(m),
  });
  assertEquals(open.length, 0);
  assertEquals(msgs.length, 0);
});
