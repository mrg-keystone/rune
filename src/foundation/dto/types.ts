// deno-lint-ignore-file no-explicit-any
import { z } from "#zod";

export interface Type<T = any> extends Function {
  new (...args: any[]): T;
  name: string;
}

export type Cotr<T = any> = new (...args: any[]) => T;

/** A standalone request dispatcher — the same `(Request) => Response` Hono hands to `Deno.serve`. */
export type FetchHandler = (req: Request) => Response | Promise<Response>;

export const HttpMethodSchema: z.ZodEnum<["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]> = z.enum([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
  "HEAD",
]);

export type HttpMethod = z.infer<typeof HttpMethodSchema>;

export function parseHttpMethod(value: unknown): HttpMethod {
  return HttpMethodSchema.parse(value);
}
