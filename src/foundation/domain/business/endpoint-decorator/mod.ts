/**
 * `@Endpoint` / `@EndpointController` — the one place keep learns about an endpoint.
 *
 * A rune-generated coordinator becomes a live, Swagger-documented HTTP route by writing a small
 * controller class whose handler is decorated with `@Endpoint`. The decorator composes danet's
 * route + body decorators (so the route is *served* and danet injects the parsed body) with
 * `@danet/swagger`'s `BodyType`/`ReturnedType` (so the request/response DTO **schemas** appear in
 * the generated OpenAPI doc), and stamps **process metadata** (`order` / `dependsOn` / `bind`)
 * that the per-module emulator UI and the headless runner read to order and chain the endpoints.
 *
 * It is a thin composition of decorators used with `@` syntax — so `emitDecoratorMetadata`
 * emits `design:paramtypes` for the handler naturally, and danet's body validation/injection work
 * exactly as for a hand-written controller.
 */

import "#reflect-metadata";
import { Body, Controller, Delete, Get, Module, Patch, Post, Put } from "#danet/core";
import { BodyType, Description, ReturnedType } from "#danet/swagger/decorators";
import { SwaggerDescription } from "@foundation/domain/business/swagger-description/mod.ts";
import type { Type } from "@types";

/** Where the per-endpoint process metadata is stored, keyed on (controller prototype, method). */
export const PROCESS_METADATA_KEY = "keep:process";

export type EndpointMethod = "get" | "post" | "put" | "patch" | "delete";

export interface EndpointOptions {
  /** HTTP verb. Defaults to "post" (an endpoint usually takes an input DTO ⇒ body). */
  method?: EndpointMethod;
  /** Sub-path under the controller surface, e.g. "" or ":id". Defaults to "". */
  path?: string;
  /** Request DTO class — drives danet body injection + the Swagger requestBody schema. */
  input?: Type;
  /** Response DTO class — drives the Swagger 200 response schema (`@ReturnedType`). */
  output?: Type;
  /** Position in the process order shown by the emulator (ascending). */
  order?: number;
  /** Endpoint id(s) — handler method names — that must succeed before this one is unlocked. */
  dependsOn?: string | string[];
  /**
   * Output→input wiring: `{ thisInputField: "otherEndpointId.outputField" }`. The emulator and
   * runner pre-fill this endpoint's request body from captured responses of the named endpoints.
   */
  bind?: Record<string, string>;
  /** Human description → OpenAPI operation description. */
  description?: string;
}

/** Normalized process metadata attached to each `@Endpoint` handler. */
export interface ProcessMetadata {
  order?: number;
  dependsOn: string[];
  bind: Record<string, string>;
  method: EndpointMethod;
  path: string;
}

const MAPPING: Record<EndpointMethod, (endpoint?: string) => MethodDecorator> = {
  get: Get,
  post: Post,
  put: Put,
  patch: Patch,
  delete: Delete,
};

/**
 * Decorate a controller handler to expose it as an HTTP endpoint with Swagger schemas + process
 * metadata. Type the handler's parameter as the input DTO (`create(body: CreateUserDto)`) — the
 * decorator wires `@Body()` for you; do not add it yourself.
 */
export function Endpoint(opts: EndpointOptions = {}): MethodDecorator {
  return (target, propertyKey, descriptor) => {
    const method = opts.method ?? "post";
    const path = opts.path ?? "";

    // 1) danet route metadata — makes the handler routable AND gives Swagger its path + method.
    MAPPING[method](path)(target, propertyKey, descriptor);

    // 2) request body — inject the parsed body at runtime and declare its type for Swagger.
    if (opts.input) {
      Body()(target, propertyKey as string, 0);
      BodyType(opts.input as unknown as Parameters<typeof BodyType>[0])(
        target,
        propertyKey,
        descriptor,
      );
    }

    // 3) response schema for Swagger.
    if (opts.output) ReturnedType(opts.output)(target, propertyKey, descriptor);

    // 4) operation description.
    if (opts.description) Description(opts.description)(target, propertyKey, descriptor);

    // 5) process metadata for the emulator + headless runner.
    const dependsOn = opts.dependsOn == null
      ? []
      : Array.isArray(opts.dependsOn)
      ? opts.dependsOn
      : [opts.dependsOn];
    const meta: ProcessMetadata = {
      order: opts.order,
      dependsOn,
      bind: opts.bind ?? {},
      method,
      path,
    };
    Reflect.defineMetadata(PROCESS_METADATA_KEY, meta, target, propertyKey);
  };
}

/** Reads the process metadata stamped by `@Endpoint`, if any. */
export function getProcessMetadata(
  // deno-lint-ignore ban-types
  target: Object,
  propertyKey: string,
): ProcessMetadata | undefined {
  return Reflect.getMetadata(PROCESS_METADATA_KEY, target, propertyKey);
}

/**
 * Class decorator turning a plain class into a danet controller mounted at `surface`. Optionally
 * attaches a Swagger module description.
 */
export function EndpointController(
  surface: string,
  opts?: { description?: string },
): ClassDecorator {
  return (target) => {
    Controller(surface)(target as unknown as Parameters<ReturnType<typeof Controller>>[0]);
    if (opts?.description) SwaggerDescription(opts.description)(target);
  };
}

/**
 * Convenience: wrap one or more endpoint controllers in a danet `@Module`, named so the generated
 * Swagger doc + `/docs/<name>` route read meaningfully (one module per rune). Pass the result to
 * `bootstrapServer`.
 */
export function endpointModule(name: string, controllers: Type[]): Type {
  @Module({ controllers })
  class EndpointModule {}
  const moduleName = name.endsWith("Module") ? name : `${name}Module`;
  Object.defineProperty(EndpointModule, "name", { value: moduleName });
  return EndpointModule as unknown as Type;
}
