import { useSignal } from "@preact/signals";

// Client-side probe of the gated API. Its fetch goes through the patched window.fetch in
// client.ts, which auto-attaches the token stored in localStorage (seeded via ?token=).
export default function ApiProbe() {
  const status = useSignal<number | null>(null);
  const body = useSignal("");
  const loading = useSignal(false);
  const hasToken = useSignal(
    typeof localStorage !== "undefined" &&
      !!localStorage.getItem("danet:token"),
  );

  const probe = async () => {
    loading.value = true;
    try {
      const res = await fetch("/api/users");
      status.value = res.status;
      body.value = await res.text();
    } catch (e) {
      status.value = -1;
      body.value = String(e);
    } finally {
      hasToken.value = !!localStorage.getItem("danet:token");
      loading.value = false;
    }
  };

  const forget = () => {
    localStorage.removeItem("danet:token");
    hasToken.value = false;
  };

  return (
    <div class="my-4 p-4 border rounded">
      <p class="mb-2 text-sm">
        stored token: <b>{hasToken.value ? "yes" : "none"}</b>
      </p>
      <button
        type="button"
        onClick={probe}
        disabled={loading.value}
        class="px-3 py-1 bg-black text-white rounded mr-2"
      >
        {loading.value ? "…" : "fetch /api/users (client-side)"}
      </button>
      <button type="button" onClick={forget} class="px-3 py-1 border rounded">
        forget token
      </button>
      {status.value !== null && (
        <pre class="mt-3 p-2 bg-gray-100 text-sm overflow-auto">HTTP {status.value}
{body.value}</pre>
      )}
    </div>
  );
}
