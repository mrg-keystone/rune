/**
 * Distill a generated per-module OpenAPI document (with `x-keep-process`) into a flat list of
 * endpoints the emulator UI and the headless runner both consume. Pure: spec in, endpoints out.
 */

import type { OpenApiDocument, ProcessExtension } from "@types";

export interface SpecEndpoint {
  /** OpenAPI operationId — the handler method name; used as the stable endpoint id. */
  id: string;
  /** Upper-case HTTP verb. */
  method: string;
  /** Spec path, app-root-relative, e.g. "/users/fetch". */
  path: string;
  order?: number;
  dependsOn: string[];
  /** `{ thisInputField: "otherEndpointId.outputField" }` — output→input wiring. */
  bind: Record<string, string>;
  /** Top-level field names of the request body DTO (for the request editor + curl). */
  inputFields: string[];
  /** Top-level field names of the 200 response DTO. */
  outputFields: string[];
  description?: string;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

function fieldsFromRef(doc: OpenApiDocument, ref: string | undefined): string[] {
  if (!ref) return [];
  const name = ref.split("/").pop();
  if (!name) return [];
  const schema = doc.components?.schemas?.[name] as { properties?: Record<string, unknown> } | undefined;
  return schema?.properties ? Object.keys(schema.properties) : [];
}

/** Extract endpoints from one module document, in declaration order (callers re-order via processOrder). */
export function endpointsFromDoc(doc: OpenApiDocument): SpecEndpoint[] {
  const endpoints: SpecEndpoint[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op?.operationId) continue;
      const process: ProcessExtension | undefined = op["x-keep-process"];
      const reqRef = op.requestBody?.content?.["application/json"]?.schema?.$ref;
      const resRef = (op.responses?.["200"] as
        | { content?: Record<string, { schema?: { $ref?: string } }> }
        | undefined)?.content?.["application/json"]?.schema?.$ref;
      endpoints.push({
        id: op.operationId,
        method: method.toUpperCase(),
        path,
        order: process?.order,
        dependsOn: process?.dependsOn ?? [],
        bind: process?.bind ?? {},
        inputFields: fieldsFromRef(doc, reqRef),
        outputFields: fieldsFromRef(doc, resRef),
        description: op.description,
      });
    }
  }
  return endpoints;
}
