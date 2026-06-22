/** A single log record for the Datadog HTTP logs intake (v2). Extra keys become attributes. */
export interface DatadogEntry {
  status: string;
  message: string;
  service: string;
  ddsource?: string;
  /** Emit time (ISO 8601). Datadog's date remapper uses this for the official log date. */
  timestamp?: string;
  /** Process-monotonic counter; sort by it to break same-millisecond ties. */
  seq?: number;
  [attribute: string]: unknown;
}

export interface DatadogOptions {
  apiKey: string;
  service: string;
  /** Datadog site, e.g. "datadoghq.com" (US, default) or "datadoghq.eu". */
  site?: string;
  /** `ddsource` tag for the entries. Defaults to "danet". */
  source?: string;
  /**
   * Deployment environment ("production", "local", "staging"…). Stamped on every shipped entry as
   * the `env` attribute and an `env:<env>` Datadog tag so production and local traffic are
   * segmented; non-production entries also get an `[ENV]` message prefix (e.g. `[LOCAL]`) so
   * they're obvious in the raw log stream. Defaults to "production".
   */
  env?: string;
  /** Injectable fetch, for tests. Defaults to the global `fetch`. */
  transport?: typeof fetch;
}

/**
 * Shipper for the Datadog HTTP logs intake. `send` POSTs a single entry immediately and
 * **throws** on a network error or non-2xx response, so the caller (the logger) can catch it
 * and raise an alert. The logger never lets that throw reach application code.
 */
export class DatadogTransport {
  private readonly endpoint: string;
  private readonly headers: HeadersInit;
  private readonly source: string;
  private readonly service: string;
  private readonly env: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: DatadogOptions) {
    const site = opts.site ?? "datadoghq.com";
    this.endpoint = `https://http-intake.logs.${site}/api/v2/logs`;
    this.headers = {
      "Content-Type": "application/json",
      "DD-API-KEY": opts.apiKey,
    };
    this.source = opts.source ?? "danet";
    this.service = opts.service;
    this.env = opts.env ?? "production";
    this.fetchFn = opts.transport ?? fetch;
  }

  /** POSTs one entry. Rejects on a network error or non-2xx response. */
  async send(entry: DatadogEntry): Promise<void> {
    const isProd = this.env === "production";
    const existingTags = typeof entry.ddtags === "string" ? entry.ddtags : "";
    const ddtags = existingTags
      ? `${existingTags},env:${this.env}`
      : `env:${this.env}`;
    const res = await this.fetchFn(this.endpoint, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify([{
        ...entry,
        ddsource: entry.ddsource ?? this.source,
        service: entry.service ?? this.service,
        // `env` attribute + `env:` tag segment production from local in Datadog; non-prod also
        // gets a visible `[ENV]` prefix in the raw message.
        env: this.env,
        ddtags,
        message: isProd
          ? entry.message
          : `[${this.env.toUpperCase()}] ${entry.message}`,
      }]),
    });
    if (!res.ok) {
      throw new Error(
        `Datadog logs intake returned ${res.status} ${res.statusText}`,
      );
    }
  }
}
