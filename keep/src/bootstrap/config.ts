const DEFAULT_PORT = 3000;

export interface AppConfig {
  port: number;
}

export function loadConfig(): AppConfig {
  const port = Number(Deno.env.get("PORT")) || DEFAULT_PORT;
  return { port };
}
