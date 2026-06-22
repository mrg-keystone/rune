import { assertEquals } from "#assert";
import { PostmarkAlerter } from "./mod.ts";

function stubFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fn = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  return { fn, calls };
}

Deno.test("PostmarkAlerter - posts an email with the server token and fields", async () => {
  const { fn, calls } = stubFetch();
  const alerter = new PostmarkAlerter({
    serverToken: "TOK",
    from: "alerts@app.com",
    to: "oncall@app.com",
    transport: fn,
  });

  await alerter.alert("Subject line", "Body text");

  assertEquals(calls[0].url, "https://api.postmarkapp.com/email");
  assertEquals(
    new Headers(calls[0].init?.headers).get("X-Postmark-Server-Token"),
    "TOK",
  );
  const body = JSON.parse(calls[0].init?.body as string);
  assertEquals(body.From, "alerts@app.com");
  assertEquals(body.To, "oncall@app.com");
  assertEquals(body.Subject, "Subject line");
  assertEquals(body.TextBody, "Body text");
});

Deno.test("PostmarkAlerter - defaults To to From when omitted", async () => {
  const { fn, calls } = stubFetch();
  const alerter = new PostmarkAlerter({
    serverToken: "T",
    from: "alerts@app.com",
    transport: fn,
  });

  await alerter.alert("s", "b");

  const body = JSON.parse(calls[0].init?.body as string);
  assertEquals(body.To, "alerts@app.com");
});

Deno.test("PostmarkAlerter - throttles within the cooldown window", async () => {
  const { fn, calls } = stubFetch();
  const alerter = new PostmarkAlerter({
    serverToken: "T",
    from: "a@x.com",
    to: "b@x.com",
    cooldownMs: 60_000,
    transport: fn,
  });

  await alerter.alert("s", "b");
  await alerter.alert("s", "b");
  await alerter.alert("s", "b");

  assertEquals(calls.length, 1); // only the first within the window is sent
});

Deno.test("PostmarkAlerter - swallows transport errors", async () => {
  const fn = (() => Promise.reject(new Error("boom"))) as typeof fetch;
  const alerter = new PostmarkAlerter({
    serverToken: "T",
    from: "a",
    to: "b",
    transport: fn,
  });

  await alerter.alert("s", "b"); // must not throw
});
