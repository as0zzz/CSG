/** Durable per-event outbox. Only KSG semantics; no passwords, raw typing or screen capture. */
type Json = Record<string, unknown>;
export interface TraceEvent {
  id: string;
  seq: number;
  kind: string;
  action_id: string | null;
  at: string;
  payload: Json;
  observation: Json;
  result: Json;
}
interface Queued {
  id: string;
  session: string;
  project: string;
  user: string;
  event: TraceEvent;
}
type Status = {
  ready: boolean;
  pending: number;
  sent: number;
  error: string;
  session: string;
  mode: string;
};
let dbPromise: Promise<IDBDatabase> | undefined;
function database() {
  return (dbPromise ||= new Promise((resolve, reject) => {
    const r = indexedDB.open("aksg-behavior-outbox", 1);
    r.onupgradeneeded = () =>
      r.result.createObjectStore("events", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  }));
}
async function entries(): Promise<Queued[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const r = db.transaction("events").objectStore("events").getAll();
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function store(value: Queued) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("events", "readwrite");
    tx.objectStore("events").put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function acknowledge(ids: string[]) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("events", "readwrite");
    ids.forEach((id) => tx.objectStore("events").delete(id));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function post(path: string, body: unknown) {
  const response = await fetch("/api" + path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: false,
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.detail || `Ошибка записи ${response.status}`);
  }
  return response.json();
}
export class Recorder {
  id: string;
  seq = 0;
  ready = false;
  sent = 0;
  pending = 0;
  error = "";
  mode: string;
  private flight: Promise<void> | null = null;
  private stopped = false;
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    public project: string,
    public user: string,
    public observe: () => Json,
    private onStatus: (s: Status) => void,
  ) {
    this.mode =
      new URLSearchParams(location.search).get("recording") === "test"
        ? "test"
        : "human";
    const key = `ksg-session:${user}:${project}:${this.mode}`;
    let prior: { id: string; seq: number } | null = null;
    try {
      prior = JSON.parse(sessionStorage.getItem(key) || "null");
    } catch {
      /* New recording if tab metadata is invalid. */
    }
    this.id = prior?.id || crypto.randomUUID();
    this.seq = prior?.seq || 0;
  }
  private notify() {
    this.onStatus({
      ready: this.ready,
      pending: this.pending,
      sent: this.sent,
      error: this.error,
      session: this.id,
      mode: this.mode,
    });
  }
  async start() {
    try {
      await post(`/projects/${this.project}/recorder/sessions`, {
        id: this.id,
        mode: this.mode,
        label: this.mode === "test" ? "Тест интерфейса" : "Рабочая сессия",
        view: this.observe(),
      });
      if (this.stopped) return;
      this.ready = true;
      this.error = "";
      this.notify();
      await this.record("session.resume", {
        interface_version: "ksg-2.0",
        mode: this.mode,
      });
      this.timer = setInterval(() => void this.flush(), 2500);
      await this.flush();
    } catch (e) {
      this.error = (e as Error).message;
      this.notify();
      if (!this.stopped)
        this.timer = setInterval(() => {
          if (!this.ready) {
            clearInterval(this.timer);
            void this.start();
          }
        }, 4000);
    }
  }
  async record(
    kind: string,
    payload: Json = {},
    action_id: string | null = null,
    result: Json = {},
  ) {
    if (this.stopped || !this.ready) return;
    const event: TraceEvent = {
      id: crypto.randomUUID(),
      seq: ++this.seq,
      kind,
      action_id,
      at: new Date().toISOString(),
      payload,
      observation: this.observe(),
      result,
    };
    try {
      sessionStorage.setItem(
        `ksg-session:${this.user}:${this.project}:${this.mode}`,
        JSON.stringify({ id: this.id, seq: this.seq }),
      );
      await store({
        id: event.id,
        session: this.id,
        project: this.project,
        user: this.user,
        event,
      });
      this.pending++;
      this.notify();
    } catch (e) {
      this.error =
        "Не удалось сохранить событие локально: " + (e as Error).message;
      this.notify();
    }
  }
  async flush() {
    if (!this.ready) return;
    while (this.flight) await this.flight;
    const flight = this.sendOutbox();
    this.flight = flight;
    try {
      await flight;
    } finally {
      if (this.flight === flight) this.flight = null;
    }
  }
  private async sendOutbox() {
    try {
      // Include earlier sessions for this user, so a refresh or project switch never discards an outbox.
      const own = (await entries()).filter((r) => r.user === this.user);
      const groups = new Map<string, Queued[]>();
      own.forEach((r) =>
        groups.set(r.session, [...(groups.get(r.session) || []), r]),
      );
      for (const rows of groups.values()) {
        rows.sort((a, b) => a.event.seq - b.event.seq);
        for (let i = 0; i < rows.length; i += 50) {
          const batch = rows.slice(i, i + 50);
          const ack = await post(
            `/projects/${batch[0].project}/recorder/sessions/${batch[0].session}/events`,
            { events: batch.map((r) => r.event) },
          );
          await acknowledge(ack.acknowledged);
          this.sent += ack.acknowledged.length;
        }
      }
      this.pending = (await entries()).filter(
        (r) => r.user === this.user,
      ).length;
      this.error = "";
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.notify();
    }
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    await this.record("page.leave");
    await this.flush();
    this.stopped = true;
  }
}
