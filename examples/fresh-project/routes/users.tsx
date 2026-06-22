import { page } from "fresh";
import { define } from "../utils.ts";

interface User {
  id: number;
  name: string;
}

// SSR: calls the Danet backend IN-PROCESS via ctx.state.api — no token, no network hop.
export const handler = define.handlers({
  async GET(ctx) {
    const users: User[] = await (await ctx.state.api.fetch("/users")).json();
    return page({ users });
  },
});

export default define.page<typeof handler>(({ data }) => (
  <div class="px-4 py-8 mx-auto max-w-screen-md">
    <h1 class="text-4xl font-bold">Users</h1>
    <p class="my-4">
      SSR via <code>ctx.state.api.fetch("/users")</code> — in-process, no token.
    </p>
    <ul class="list-disc pl-6">
      {data.users.map((u) => <li key={u.id}>{u.id}: {u.name}</li>)}
    </ul>
  </div>
));
