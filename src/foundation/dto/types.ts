// deno-lint-ignore-file no-explicit-any
import { z } from "#zod";

export interface Type<T = any> extends Function {
  new (...args: any[]): T;
  name: string;
}

export type Cotr<T = any> = new (...args: any[]) => T;

/**
 * A standalone request dispatcher — the same handler `Deno.serve` invokes. The optional second
 * argument is Deno's per-connection info (`remoteAddr`, …); forward it when mounting this handler
 * behind another `Deno.serve` listener so loopback/localhost detection keeps working:
 * `Deno.serve((req, info) => handler(req, info))`.
 */
export type FetchHandler = (
  req: Request,
  info?: Deno.ServeHandlerInfo,
) => Response | Promise<Response>;

/** The `x-keep-process` vendor extension carried on each operation (see endpoint-decorator). */
export interface ProcessExtension {
  order?: number;
  dependsOn: string[];
  bind: Record<string, string>;
  method: string;
  path: string;
}

/** Minimal structural view of the parts of an OpenAPI operation the emulator/runner read. */
export interface OpenApiOperation {
  operationId?: string;
  description?: string;
  requestBody?: { content?: Record<string, { schema?: { $ref?: string } }> };
  responses?: Record<string, unknown>;
  parameters?: Array<{ name: string; in: string; required?: boolean }>;
  "x-keep-process"?: ProcessExtension;
  [key: string]: unknown;
}

/** Minimal structural view of a generated per-module OpenAPI document. */
export interface OpenApiDocument {
  info?: { title?: string; version?: string; description?: string };
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, unknown> };
  [key: string]: unknown;
}

/** One per-module Swagger document plus the docs path it's served under. */
export interface SwaggerDocEntry {
  path: string;
  doc: OpenApiDocument;
}

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
