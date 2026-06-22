export interface PostmarkOptions {
  serverToken: string;
  /** Sender address — must be a verified Postmark sender signature / domain. */
  from: string;
  /** Alert recipient. Defaults to `from` (alert yourself). */
  to?: string;
  /** Minimum gap between alert emails, to avoid a storm during an outage. Default 5 minutes. */
  cooldownMs?: number;
  /** Injectable fetch, for tests. Defaults to the global `fetch`. */
  transport?: typeof fetch;
}

const ENDPOINT = "https://api.postmarkapp.com/email";
const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

/**
 * Sends alert emails via Postmark when the logger itself fails to deliver. Throttled to one
 * email per cooldown window — a Datadog outage would otherwise fail every log and flood the
 * inbox. Never throws (it can't alert about the alerter).
 */
export class PostmarkAlerter {
  private readonly from: string;
  private readonly to: string;
  private readonly headers: HeadersInit;
  private readonly fetchFn: typeof fetch;
  private readonly cooldownMs: number;
  private lastAlertAt = 0;

  constructor(opts: PostmarkOptions) {
    this.from = opts.from;
    this.to = opts.to ?? opts.from;
    this.headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-Postmark-Server-Token": opts.serverToken,
    };
    this.fetchFn = opts.transport ?? fetch;
    this.cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  async alert(subject: string, body: string): Promise<void> {
    const now = Date.now();
    if (now - this.lastAlertAt < this.cooldownMs) return; // throttled
    this.lastAlertAt = now;
    try {
      await this.fetchFn(ENDPOINT, {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({
          From: this.from,
          To: this.to,
          Subject: subject,
          TextBody: body,
        }),
      });
    } catch {
      // Swallow — we cannot raise an alert about the alerter failing.
    }
  }
}
