import { assertEquals } from "#assert";
import { DatadogTransport } from "./mod.ts";

function stubFetch(status = 202) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(new Response("{}", { status }));
  }) as typeof fetch;
  return { fn, calls };
}

Deno.test("DatadogTransport - send POSTs one entry as an array with the api key header", async () => {
  const { fn, calls } = stubFetch();
  const dd = new DatadogTransport({
    apiKey: "KEY",
    service: "svc",
    transport: fn,
  });

  await dd.send({ status: "info", message: "hi", service: "svc" });

  assertEquals(calls.length, 1);
  assertEquals(
    calls[0].url,
    "https://http-intake.logs.datadoghq.com/api/v2/logs",
  );
  assertEquals(new Headers(calls[0].init?.headers).get("DD-API-KEY"), "KEY");
  const body = JSON.parse(calls[0].init?.body as string);
  assertEquals(Array.isArray(body), true);
  assertEquals(body[0].message, "hi");
  assertEquals(body[0].ddsource, "danet");
});

Deno.test("DatadogTransport - default env is production: no prefix, env tag present", async () => {
  const { fn, calls } = stubFetch();
  const dd = new DatadogTransport({
    apiKey: "K",
    service: "svc",
    transport: fn,
  });

  await dd.send({ status: "info", message: "hi", service: "svc" });

  const body = JSON.parse(calls[0].init?.body as string);
  assertEquals(body[0].message, "hi", "production messages are not prefixed");
  assertEquals(body[0].env, "production");
  assertEquals(body[0].ddtags, "env:production");
});

Deno.test("DatadogTransport - local env tags env:local and prefixes [LOCAL]", async () => {
  const { fn, calls } = stubFetch();
  const dd = new DatadogTransport({
    apiKey: "K",
    service: "svc",
    env: "local",
    transport: fn,
  });

  await dd.send({ status: "info", message: "hi", service: "svc" });

  const body = JSON.parse(calls[0].init?.body as string);
  assertEquals(body[0].message, "[LOCAL] hi");
  assertEquals(body[0].env, "local");
  assertEquals(body[0].ddtags, "env:local");
});

Deno.test("DatadogTransport - env tag is appended to existing ddtags", async () => {
  const { fn, calls } = stubFetch();
  const dd = new DatadogTransport({
    apiKey: "K",
    service: "svc",
    env: "local",
    transport: fn,
  });

  await dd.send({
    status: "info",
    message: "hi",
    service: "svc",
    ddtags: "team:payments",
  });

  const body = JSON.parse(calls[0].init?.body as string);
  assertEquals(body[0].ddtags, "team:payments,env:local");
});

Deno.test("DatadogTransport - honors a custom site", async () => {
  const { fn, calls } = stubFetch();
  const dd = new DatadogTransport({
    apiKey: "K",
    service: "svc",
    site: "datadoghq.eu",
    transport: fn,
  });

  await dd.send({ status: "info", message: "x", service: "svc" });

  assertEquals(
    calls[0].url,
    "https://http-intake.logs.datadoghq.eu/api/v2/logs",
  );
});

Deno.test("DatadogTransport - send rejects on a non-2xx response", async () => {
  const { fn } = stubFetch(403);
  const dd = new DatadogTransport({
    apiKey: "K",
    service: "svc",
    transport: fn,
  });

  let threw = false;
  try {
    await dd.send({ status: "info", message: "x", service: "svc" });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("DatadogTransport - send rejects on a network error", async () => {
  const fn = (() => Promise.reject(new Error("boom"))) as typeof fetch;
  const dd = new DatadogTransport({
    apiKey: "K",
    service: "svc",
    transport: fn,
  });

  let threw = false;
  try {
    await dd.send({ status: "error", message: "x", service: "svc" });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
