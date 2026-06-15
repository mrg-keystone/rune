import { define } from "../utils.ts";
import ApiProbe from "../islands/ApiProbe.tsx";

export default define.page(function Probe() {
  return (
    <div class="px-4 py-8 mx-auto max-w-screen-md">
      <h1 class="text-4xl font-bold">API probe</h1>
      <p class="my-4">
        The button below fetches <code>/api/users</code>{" "}
        from the browser. The patched <code>fetch</code> (in{" "}
        <code>client.ts</code>) auto-attaches a token from{" "}
        <code>localStorage</code>, seeded once from <code>?token=</code>.
      </p>
      <ol class="list-decimal pl-6 my-4 text-sm space-y-1">
        <li>
          Run the dev server gated, so localhost needs a token like production:
          {" "}
          <code>
            INFRA_BASE_URL=&lt;infra&gt; TRUST_LOCALHOST=false deno task dev
          </code>.
        </li>
        <li>
          Fetch now (no token) → <b>401</b>.
        </li>
        <li>
          Seed a token: open <code>/probe?token=&lt;TOKEN&gt;</code>{" "}
          (it's saved, then stripped from the URL). Fetch again → <b>200</b>.
        </li>
        <li>
          Reload this page (no{" "}
          <code>?token</code>) → still 200, from localStorage.
        </li>
        <li>"forget token" (or a 401) clears it → back to 401.</li>
      </ol>
      <ApiProbe />
    </div>
  );
});
