import { AsyncLocalStorage } from "node:async_hooks";
import type {
  DatadogEntry,
  DatadogTransport,
} from "@foundation/domain/data/datadog/mod.ts";
import type { PostmarkAlerter } from "@foundation/domain/data/postmark/mod.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface RequestContext {
  appName: string;
  requestId: string;
  /** Set from a verified access token; tags every log emitted during the request. */
  source?: string;
  /** Datadog sends fired during this request; awaited by `settle()` before the response. */
  pending: Promise<void>[];
}

export interface LoggerConfig {
  appName: string;
  datadog?: DatadogTransport;
  alerter?: PostmarkAlerter;
}

/**
 * Structured logger with request-scoped correlation. Inside a request (see `runInRequest`)
 * every `log.*` call is tagged with `[<app> <requestId>]`; outside one, `[<app>]`. The
 * structured-data argument becomes log attributes — the expandable JSON ("the zippy") in
 * Datadog.
 *
 * Calls are synchronous: a log writes to the console and immediately fires (fire-and-forget)
 * the Datadog request, collecting its promise on the request so `settle()` can await all of
 * them before the response is sent. A send never throws into the caller — on failure it
 * raises a Postmark alert instead.
 */
export class Logger {
  private appName = "app";
  private datadog?: DatadogTransport;
  private alerter?: PostmarkAlerter;
  private seq = 0;
  private readonly als = new AsyncLocalStorage<RequestContext>();

  configure(config: LoggerConfig) {
    this.appName = config.appName;
    this.datadog = config.datadog;
    this.alerter = config.alerter;
  }

  /** Run `fn` inside a request scope so any `log.*` it triggers correlates to `requestId`. */
  runInRequest<T>(requestId: string, fn: () => T): T {
    return this.als.run({ appName: this.appName, requestId, pending: [] }, fn);
  }

  currentRequest(): RequestContext | undefined {
    return this.als.getStore();
  }

  /** Attribute the current request to a verified token `source`; no-op outside a request. */
  setSource(source: string) {
    const ctx = this.currentRequest();
    if (ctx) ctx.source = source;
  }

  /**
   * Awaits every Datadog send started during the current request. The middleware calls this
   * just before sending the response, so all log requests have returned first. Never rejects.
   */
  async settle(): Promise<void> {
    const ctx = this.currentRequest();
    if (!ctx || ctx.pending.length === 0) return;
    await Promise.all(ctx.pending.splice(0));
  }

  debug(msg: string, data?: Record<string, unknown>) {
    this.emit("debug", msg, data);
  }
  info(msg: string, data?: Record<string, unknown>) {
    this.emit("info", msg, data);
  }
  warn(msg: string, data?: Record<string, unknown>) {
    this.emit("warn", msg, data);
  }
  error(msg: string, data?: Record<string, unknown>) {
    this.emit("error", msg, data);
  }

  /**
   * Framework-internal: a request-lifecycle log tagged `ingress`/`egress`, e.g.
   * `[ingress <app> <requestId>] GET /users`.
   */
  lifecycle(
    kind: "ingress" | "egress",
    level: LogLevel,
    method: string,
    route: string,
    data?: Record<string, unknown>,
  ) {
    const ctx = this.currentRequest();
    const id = ctx?.requestId ?? "-";
    const message = `[${kind} ${this.appName} ${id}] ${method} ${route}`;
    this.write(level, message, {
      kind,
      method,
      route,
      requestId: id,
      ...(ctx?.source ? { source: ctx.source } : {}),
      ...data,
    });
  }

  private emit(level: LogLevel, msg: string, data?: Record<string, unknown>) {
    const ctx = this.currentRequest();
    const prefix = ctx
      ? `[${this.appName} ${ctx.requestId}]`
      : `[${this.appName}]`;
    const attrs: Record<string, unknown> = { ...data };
    if (ctx) {
      attrs.requestId = ctx.requestId;
      if (ctx.source) attrs.source = ctx.source;
    }
    this.write(level, `${prefix} ${msg}`, attrs);
  }

  private write(
    level: LogLevel,
    message: string,
    attrs: Record<string, unknown>,
  ) {
    try {
      this.writeConsole(level, message, attrs);
    } catch {
      // The console must never throw into the caller.
    }
    if (!this.datadog) return;

    // Reserved intake fields are set last so user attributes can never clobber them.
    // `timestamp` (call time) drives Datadog's log date; `seq` is a process-monotonic
    // tiebreaker. Both are captured here, so ordering reflects when log() was called.
    const entry: DatadogEntry = {
      ...attrs,
      timestamp: new Date().toISOString(),
      seq: ++this.seq,
      status: level,
      service: this.appName,
      message,
    };

    // Fire the request now (as the log happens). In a request, collect the promise so the
    // middleware can await it before responding; otherwise let it run fire-and-forget.
    const sent = this.dispatch(entry);
    const ctx = this.currentRequest();
    if (ctx) ctx.pending.push(sent);
    else void sent;
  }

  /** Sends one entry; never rejects. On failure, falls back to console and emails an alert. */
  private dispatch(entry: DatadogEntry): Promise<void> {
    return (async () => {
      try {
        await this.datadog!.send(entry);
      } catch (err) {
        this.onDeliveryFailure(err, entry);
      }
    })();
  }

  private onDeliveryFailure(err: unknown, entry: DatadogEntry) {
    // Surface the failure on the console so a dropped log is never silent...
    try {
      console.error(`[${this.appName}] Datadog log delivery failed`, {
        error: err instanceof Error ? err.message : String(err),
        log: entry.message,
      });
    } catch {
      // ignore
    }
    // ...and raise a throttled email alert (fire-and-forget).
    void this.alertFailure(err, entry);
  }

  private async alertFailure(err: unknown, entry: DatadogEntry): Promise<void> {
    try {
      const detail = err instanceof Error
        ? (err.stack ?? err.message)
        : String(err);
      await this.alerter?.alert(
        `[${this.appName}] Logger delivery failure`,
        `The logger failed to deliver a log to Datadog.\n\n` +
          `Error:\n${detail}\n\n` +
          `Log message: ${entry.message}\n` +
          `At: ${new Date().toISOString()}`,
      );
    } catch {
      // Never throw from the failure path itself.
    }
  }

  private writeConsole(
    level: LogLevel,
    message: string,
    attrs: Record<string, unknown>,
  ) {
    const args: unknown[] = Object.keys(attrs).length > 0
      ? [message, attrs]
      : [message];
    switch (level) {
      case "debug":
        console.debug(...args);
        break;
      case "warn":
        console.warn(...args);
        break;
      case "error":
        console.error(...args);
        break;
      default:
        console.info(...args);
    }
  }
}

/** Process-wide logger. `bootstrapServer` configures it; import it anywhere to log. */
export const log: Logger = new Logger();
