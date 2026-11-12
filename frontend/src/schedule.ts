export interface Task {
  id: string;
  code: string;
  title: string;
  start_date: string;
  end_date: string;
  duration_days: number;
  predecessor_ids: string[];
  version: number;
}
export interface Schedule {
  project_id: string;
  project: { id: string; code: string; name: string; start_date: string };
  tasks: Task[];
  links: { id: string; from: string; to: string }[];
  editable: boolean;
}
export const DAY = 86400000;
export const day = (value: string) => Date.parse(value + "T00:00:00Z") / DAY;
export const iso = (value: number) =>
  new Date(value * DAY).toISOString().slice(0, 10);
export const shift = (value: string, delta: number) => iso(day(value) + delta);
export const dateLabel = (value: string) =>
  new Date(value + "T12:00:00Z").toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
export function sorted(tasks: Task[]) {
  return [...tasks].sort((a, b) =>
    a.code.localeCompare(b.code, "ru", { numeric: true }),
  );
}

/** Calendar-day finish-to-start CPM; manual delays are shown separately as conflicts. */
export function analyze(tasks: Task[]) {
  const byId = new Map(tasks.map((t) => [t.id, t])),
    order: string[] = [],
    visited = new Set<string>(),
    visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error("Цикл зависимостей");
    if (visited.has(id)) return;
    visiting.add(id);
    byId
      .get(id)
      ?.predecessor_ids.filter((p) => byId.has(p))
      .forEach(visit);
    visiting.delete(id);
    visited.add(id);
    order.push(id);
  };
  tasks.forEach((t) => visit(t.id));
  const early = new Map<string, number>(),
    finish = new Map<string, number>(),
    rank = new Map<string, number>();
  order.forEach((id) => {
    const t = byId.get(id)!;
    early.set(
      id,
      Math.max(0, ...t.predecessor_ids.map((p) => finish.get(p) || 0)),
    );
    finish.set(id, early.get(id)! + t.duration_days);
    rank.set(
      id,
      Math.max(
        0,
        ...t.predecessor_ids
          .filter((p) => byId.has(p))
          .map((p) => (rank.get(p) || 0) + 1),
      ),
    );
  });
  const duration = Math.max(0, ...finish.values()),
    late = new Map<string, number>(),
    critical = new Set<string>();
  [...order].reverse().forEach((id) => {
    const successors = tasks.filter((t) => t.predecessor_ids.includes(id));
    const latestFinish = successors.length
      ? Math.min(...successors.map((t) => late.get(t.id)!))
      : duration;
    late.set(id, latestFinish - byId.get(id)!.duration_days);
    if (late.get(id) === early.get(id)) critical.add(id);
  });
  const conflicts = tasks.flatMap((t) =>
    t.predecessor_ids
      .filter(
        (p) => byId.has(p) && day(t.start_date) <= day(byId.get(p)!.end_date),
      )
      .map((p) => ({ from: p, to: t.id })),
  );
  return { critical, duration, rank, conflicts, order };
}
