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
  const dd = new DatadogTransport({ apiKey: "KEY", service: "svc", transport: fn });

  await dd.send({ status: "info", message: "hi", service: "svc" });

  assertEquals(calls.length, 1);
  assertEquals(calls[0].url, "https://http-intake.logs.datadoghq.com/api/v2/logs");
  assertEquals(new Headers(calls[0].init?.headers).get("DD-API-KEY"), "KEY");
  const body = JSON.parse(calls[0].init?.body as string);
  assertEquals(Array.isArray(body), true);
  assertEquals(body[0].message, "hi");
  assertEquals(body[0].ddsource, "danet");
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

  assertEquals(calls[0].url, "https://http-intake.logs.datadoghq.eu/api/v2/logs");
});

Deno.test("DatadogTransport - send rejects on a non-2xx response", async () => {
  const { fn } = stubFetch(403);
  const dd = new DatadogTransport({ apiKey: "K", service: "svc", transport: fn });

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
  const dd = new DatadogTransport({ apiKey: "K", service: "svc", transport: fn });

  let threw = false;
  try {
    await dd.send({ status: "error", message: "x", service: "svc" });
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});
