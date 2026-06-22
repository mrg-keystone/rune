import "#reflect-metadata";

const SWAGGER_DESCRIPTION_KEY = "swagger:description";

export function SwaggerDescription(description: string): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(SWAGGER_DESCRIPTION_KEY, description, target);
  };
}

// deno-lint-ignore ban-types
export function getSwaggerDescription(target: Object): string | undefined {
  return Reflect.getMetadata(SWAGGER_DESCRIPTION_KEY, target);
}
