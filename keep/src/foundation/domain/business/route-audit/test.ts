import "#reflect-metadata";
import { assertEquals } from "#assert";
import { Controller, Get, Module, Post } from "#danet/core";
import { Public } from "@foundation/domain/business/public-route/mod.ts";
import { Internal } from "@foundation/domain/business/internal-route/mod.ts";
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
  // points authors at @Internal() as the escape hatch for intentional in-process routes
  assertEquals(msgs[0].includes("@Internal()"), true);
});

Deno.test("@Internal routes classify as internal, not open, and never trip the audit", () => {
  @Controller("http")
  class OrchestratorController {
    // reached only by the in-process client's tick loop — bare, but deliberately so
    @Internal()
    @Post("orchestrator-tick")
    tick() {}

    // a genuinely-forgotten bare route on the same controller still surfaces
    @Post("forgotten")
    forgotten() {}
  }
  @Module({ controllers: [OrchestratorController] })
  class OrchestratorModule {}

  const rows = auditRoutes([OrchestratorModule]);
  assertEquals(entry(rows, "tick").posture, "internal");
  assertEquals(entry(rows, "forgotten").posture, "open");

  // only the forgotten route is open; @Internal is excluded
  const open = openRoutes([OrchestratorModule]);
  assertEquals(open.map((r) => r.handler), ["forgotten"]);

  const msgs: string[] = [];
  warnOpenRoutes([OrchestratorModule], {
    appName: "demo",
    honorSkeleton: true,
    warn: (m) => msgs.push(m),
  });
  // the warning names the forgotten route but NOT the @Internal tick route
  assertEquals(msgs.length, 1);
  assertEquals(msgs[0].includes("/http/forgotten"), true);
  assertEquals(msgs[0].includes("orchestrator-tick"), false);
});

Deno.test("a fully @Internal controller is silent (no open routes)", () => {
  @Internal()
  @Controller("internal")
  class FullyInternalController {
    @Get()
    read() {}

    @Post("tick")
    tick() {}
  }
  @Module({ controllers: [FullyInternalController] })
  class FullyInternalModule {}

  const rows = auditRoutes([FullyInternalModule]);
  // class-level @Internal is inherited by every route, just like class-level @LoggedIn
  assertEquals(rows.every((r) => r.posture === "internal"), true);

  const msgs: string[] = [];
  const open = warnOpenRoutes([FullyInternalModule], {
    appName: "demo",
    honorSkeleton: true,
    warn: (m) => msgs.push(m),
  });
  assertEquals(open.length, 0);
  assertEquals(msgs.length, 0);
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
