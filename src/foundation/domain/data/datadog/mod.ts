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
    this.fetchFn = opts.transport ?? fetch;
  }

  /** POSTs one entry. Rejects on a network error or non-2xx response. */
  async send(entry: DatadogEntry): Promise<void> {
    const res = await this.fetchFn(this.endpoint, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify([{
        ...entry,
        ddsource: entry.ddsource ?? this.source,
        service: entry.service ?? this.service,
      }]),
    });
    if (!res.ok) {
      throw new Error(`Datadog logs intake returned ${res.status} ${res.statusText}`);
    }
  }
}
