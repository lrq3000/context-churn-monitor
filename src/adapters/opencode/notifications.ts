import { createHash } from 'node:crypto';

/** Managed OpenChamber supplies this authenticated callback. No callback means console + persisted alerts, not a guessed port. */
export class OpenChamberNotifications {
  constructor(private directory: string, private title: (session: string, signal: AbortSignal) => Promise<string | undefined>, private environment: NodeJS.ProcessEnv = process.env) {}

  async send(session: string, message: string): Promise<void> {
    const callback = this.environment.OPENCHAMBER_AGENT_TOOL_URL, token = this.environment.OPENCHAMBER_AGENT_TOOL_TOKEN;
    if (!callback || !token) return;
    let thread = session;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    // SDK 2.2.5 can ignore the request's signal. Race independently so an uncancellable lookup cannot block the serial capture loop or suppress fallback.
    const deadline = new Promise<undefined>(resolve => { timer = setTimeout(() => { resolve(undefined); controller.abort(); }, 1000); });
    try { thread = (await Promise.race([this.title(session, controller.signal), deadline]))?.trim() || session; }
    catch { /* A missing, deleted or unavailable title must not suppress a routable alert. */ }
    finally { clearTimeout(timer!); }
    const prefix = 'Context Churn Monitor · ';
    const project = this.directory.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || 'Project';
    const payload = {
      title: prefix + this.text(thread, 120 - prefix.length),
      body: `Project: ${this.text(project, 80)}\nThread: ${this.text(thread, 160)}\n${this.text(message, 220)}`,
      // Text identifies the thread to the reader; these exact host fields independently drive native and in-app click navigation.
      sessionId: session, directory: this.directory,
      tag: `context-monitor-${createHash('sha256').update(session).update('\0').update(message).digest('hex').slice(0, 32)}`,
    };
    try {
      await fetch(new URL('/api/notifications/emit', callback), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(3000) });
    } catch { /* The persistent alert remains visible even when notification delivery is unavailable. */ }
  }

  /** Host limits use UTF-16 length; avoid truncating between a surrogate pair and keep controls out of notification labels. */
  private text(value: string, limit: number): string {
    const text = value.replace(/[\s\u0000-\u001f\u007f]+/g, ' ').trim();
    return text.length <= limit ? text : text.slice(0, limit - 1).replace(/[\ud800-\udbff]$/, '') + '…';
  }
}
