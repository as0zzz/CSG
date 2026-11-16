import { useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronDown,
  Download,
  GitBranch,
  GripVertical,
  Link2,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { api } from "./api";
import { Recorder } from "./recorder";
import {
  analyze,
  dateLabel,
  day,
  iso,
  Schedule,
  shift,
  sorted,
  Task,
} from "./schedule";

type Obj = Record<string, any>;
const names: Record<string, string> = {
  "ui.click": "Нажатие",
  "field.focus": "Выбор поля",
  "field.commit": "Изменение поля",
  "selection.change": "Выбор работы",
  "filter.change": "Поиск работ",
  "view.change": "Смена представления",
  "zoom.change": "Масштаб календаря",
  scroll: "Прокрутка",
  gesture: "Перетаскивание",
  "action.requested": "Начало действия",
  "action.succeeded": "Действие выполнено",
  "action.failed": "Ошибка действия",
  "task.create": "Создание работы",
  "task.update": "Изменение работы",
  "task.schedule": "Изменение срока",
  "task.status": "Изменение статуса",
  "task.quantity": "Изменение объёма",
  "task.stationing": "Изменение места / пикетажа",
  "task.assignment": "Изменение ответственного",
  "task.classification": "Изменение раздела КСГ",
  "task.move": "Перенос работы",
  "task.resize": "Изменение длительности",
  "task.archive": "Удаление из графика",
  "schedule.recalculate": "Расчёт по связям",
  "session.resume": "Открытие сессии",
  "page.leave": "Выход из представления",
  "page.hidden": "Вкладка скрыта",
  "page.visible": "Возврат во вкладку",
  "export.requested": "Выгрузка записи",
  "dependency.edit": "Изменение связей",
};
const statusNames: Record<Task["status"], string> = {
  planned: "Запланирована",
  in_progress: "В работе",
  suspended: "Приостановлена",
  completed: "Завершена",
};
const statusOptions: { value: Task["status"]; label: string }[] = [
  { value: "planned", label: statusNames.planned },
  { value: "in_progress", label: statusNames.in_progress },
  { value: "suspended", label: statusNames.suspended },
  { value: "completed", label: statusNames.completed },
];
const units: Task["unit"][] = ["м", "м³", "м²", "шт", "т"];
const nowDate = () => new Date().toLocaleDateString("sv-SE");
const EMPTY_STATUS = {
  ready: false,
  pending: 0,
  sent: 0,
  error: "",
  session: "",
  mode: "human",
};
const inputTask = (t: Task) => ({
  code: t.code,
  title: t.title,
  section: t.section,
  contractor_id: t.contractor_id,
  responsible_id: t.responsible_id,
  linear: t.linear,
  axis_id: t.axis_id,
  start_m: t.start_m,
  end_m: t.end_m,
  location: t.location,
  start_date: t.start_date,
  duration_days: t.duration_days,
  actual_start: t.actual_start,
  actual_end: t.actual_end,
  unit: t.unit,
  planned: t.planned,
  status: t.status,
  reason: "",
  predecessor_ids: t.predecessor_ids,
  version: t.version,
});
const fieldNames: Record<string, string> = {
  code: "Код",
  title: "Название",
  section: "Раздел",
  contractor_id: "Подрядчик",
  responsible_id: "Ответственный",
  linear: "Тип места",
  axis_id: "Ось / путь",
  start_m: "Начальный пикет",
  end_m: "Конечный пикет",
  location: "Место выполнения",
  start_date: "Начало по плану",
  end_date: "Окончание по плану",
  duration_days: "Длительность",
  actual_start: "Фактическое начало",
  actual_end: "Фактическое окончание",
  unit: "Единица объёма",
  planned: "Плановый объём",
  status: "Статус",
  predecessor_ids: "Предшествующие работы",
};
function eventSummary(event: Obj) {
  const payload = event.payload || {};
  if (payload.entity === "dependency") {
    const added = payload.added?.length || 0;
    const removed = payload.removed?.length || 0;
    return [added ? `Добавлено связей: ${added}` : "", removed ? `Удалено связей: ${removed}` : ""]
      .filter(Boolean).join(" · ") || "Связи без изменений";
  }
  const changes = payload.change_set as Obj[] | undefined;
  if (changes?.length) {
    const names = [...new Set(changes.flatMap((change) => Object.keys(change.fields || {})))];
    const operations = changes.filter((change) => change.operation === "created" || change.operation === "removed");
    const labels = names.map((name) => fieldNames[name] || name);
    if (operations.some((change) => change.operation === "created")) labels.unshift("Создана работа");
    if (operations.some((change) => change.operation === "removed")) labels.unshift("Убрана работа");
    if (changes.some((change) => change.entity === "dependency")) labels.push("Изменены связи");
    return [...new Set(labels)].join(" · ") || "Изменение графика";
  }
  return payload.code || payload.target || payload.kind || payload.operation || payload.field || event.result?.error || "—";
}
function eventLabel(event: Obj) {
  const completedKind = event.kind === "action.succeeded" ? event.payload?.kind : null;
  const kind = completedKind || event.kind;
  const label = names[kind] || kind;
  return completedKind ? `${label} · выполнено` : label;
}

type NetworkNodePosition = { id: string; x: number; y: number };
type NetworkPoint = [number, number];
type NetworkSegment = { from: NetworkPoint; to: NetworkPoint };

function roundedOrthogonalPath(points: NetworkPoint[], radius = 7) {
  const format = (value: number) => value.toFixed(1);
  let path = `M${format(points[0][0])} ${format(points[0][1])}`;

  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [prevX, prevY] = points[i - 1];
    const [nextX, nextY] = points[i + 1];
    const inX = x - prevX;
    const inY = y - prevY;
    const outX = nextX - x;
    const outY = nextY - y;
    const inLength = Math.hypot(inX, inY);
    const outLength = Math.hypot(outX, outY);
    if (inLength < 0.1 || outLength < 0.1) continue;

    const bend = Math.min(radius, inLength / 2, outLength / 2);
    path += ` L${format(x - (inX / inLength) * bend)} ${format(y - (inY / inLength) * bend)}`;
    path += ` Q${format(x)} ${format(y)} ${format(x + (outX / outLength) * bend)} ${format(y + (outY / outLength) * bend)}`;
  }

  const [lastX, lastY] = points[points.length - 1];
  return `${path} L${format(lastX)} ${format(lastY)}`;
}

function segmentHitsNode(
  from: NetworkPoint,
  to: NetworkPoint,
  node: NetworkNodePosition,
) {
  const left = node.x - 9;
  const right = node.x + 189;
  const top = node.y - 9;
  const bottom = node.y + 79;

  if (Math.abs(from[1] - to[1]) < 0.1) {
    const low = Math.min(from[0], to[0]);
    const high = Math.max(from[0], to[0]);
    return from[1] > top && from[1] < bottom && high > left && low < right;
  }
  if (Math.abs(from[0] - to[0]) < 0.1) {
    const low = Math.min(from[1], to[1]);
    const high = Math.max(from[1], to[1]);
    return from[0] > left && from[0] < right && high > top && low < bottom;
  }
  return true;
}

function pathCrossingCost(points: NetworkPoint[], routed: NetworkSegment[]) {
  let cost = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 0.1) continue;
    for (const segment of routed) {
      const c = segment.from;
      const d = segment.to;
      if (Math.abs(c[0] - d[0]) + Math.abs(c[1] - d[1]) < 0.1) continue;
      const aHorizontal = Math.abs(a[1] - b[1]) < 0.1;
      const cHorizontal = Math.abs(c[1] - d[1]) < 0.1;

      if (aHorizontal && cHorizontal && Math.abs(a[1] - c[1]) < 0.1) {
        const overlap = Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) -
          Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0]));
        if (overlap > 2) cost += 500 + overlap * 2;
        continue;
      }
      if (!aHorizontal && !cHorizontal && Math.abs(a[0] - c[0]) < 0.1) {
        const overlap = Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) -
          Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1]));
        if (overlap > 2) cost += 500 + overlap * 2;
        continue;
      }

      const horizontal = aHorizontal ? [a, b] : [c, d];
      const vertical = aHorizontal ? [c, d] : [a, b];
      const crosses =
        Math.min(horizontal[0][0], horizontal[1][0]) <= vertical[0][0] &&
        vertical[0][0] <= Math.max(horizontal[0][0], horizontal[1][0]) &&
        Math.min(vertical[0][1], vertical[1][1]) <= horizontal[0][1] &&
        horizontal[0][1] <= Math.max(vertical[0][1], vertical[1][1]);
      if (crosses) cost += 180;
    }
  }
  return cost;
}

function networkLinkPoints(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  obstacles: NetworkNodePosition[],
  routed: NetworkSegment[],
) {
  const score = (points: NetworkPoint[]) => {
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      length += Math.abs(points[i][0] - points[i - 1][0]) +
        Math.abs(points[i][1] - points[i - 1][1]);
    }
    return length + Math.max(0, points.length - 2) * 8 +
      pathCrossingCost(points, routed);
  };

  if (!obstacles.length) {
    const bendXs = [sx + (tx - sx) / 2, sx + 14, tx - 14];
    return bendXs
      .map((bendX) => [[sx, sy], [bendX, sy], [bendX, ty], [tx, ty]] as NetworkPoint[])
      .sort((left, right) => score(left) - score(right))[0];
  }

  const exitX = sx + 14;
  const entryX = tx - 14;
  const boundaries = obstacles
    .flatMap((node) => [node.y - 14, node.y + 84])
    .sort((a, b) => a - b);
  const lanes = new Set([sy, ty, (sy + ty) / 2, ...boundaries]);
  for (let i = 1; i < boundaries.length; i++) {
    if (boundaries[i] - boundaries[i - 1] > 18)
      lanes.add((boundaries[i] + boundaries[i - 1]) / 2);
  }

  const candidates = [...lanes].map((laneY) => [
    [sx, sy],
    [exitX, sy],
    [exitX, laneY],
    [entryX, laneY],
    [entryX, ty],
    [tx, ty],
  ] as NetworkPoint[]);
  const valid = candidates.filter((points) => {
    for (let i = 1; i < points.length; i++) {
      if (obstacles.some((node) => segmentHitsNode(points[i - 1], points[i], node)))
        return false;
    }
    return true;
  });

  return (valid.length ? valid : candidates)
    .sort((left, right) => score(left) - score(right))[0];
}

export default function Planner() {
  const [user, setUser] = useState<Obj | null>(null),
    [projects, setProjects] = useState<Obj[]>([]),
    [pid, setPid] = useState(""),
    [plan, setPlan] = useState<Schedule | null>(null);
  const [login, setLogin] = useState({
      email: "planner@demo.local",
      password: "",
    }),
    [boot, setBoot] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [view, setView] = useState("gantt"),
    [query, setQuery] = useState(""),
    [scale, setScale] = useState(44),
    [criticalOn, setCriticalOn] = useState(true),
    [pan, setPan] = useState<number | null>(null);
  const [selected, setSelected] = useState(""),
    [editor, setEditor] = useState<Obj | null>(null),
    [popup, setPopup] = useState<Obj | null>(null),
    [preview, setPreview] = useState<Obj | null>(null),
    [undo, setUndo] = useState<Task | null>(null);
  const [recordStatus, setRecordStatus] = useState(EMPTY_STATUS),
    [sessions, setSessions] = useState<Obj[]>([]),
    [traceId, setTraceId] = useState(""),
    [events, setEvents] = useState<Obj[]>([]),
    [eventCount, setEventCount] = useState(0),
    [detail, setDetail] = useState<Obj | null>(null);
  const recorder = useRef<Recorder | null>(null),
    live = useRef<Obj>({}),
    grid = useRef<HTMLDivElement | null>(null),
    drag = useRef<Obj | null>(null),
    lastDrag = useRef(0),
    scrollTimer = useRef<ReturnType<typeof setTimeout>>(),
    searchTimer = useRef<ReturnType<typeof setTimeout>>(),
    busyRef = useRef(false);
  busyRef.current = busy;
  const tasks = sorted(plan?.tasks || []),
    byId = new Map(tasks.map((t) => [t.id, t]));
  const metrics = analyze(tasks),
    visible = tasks.filter((t) =>
      (t.code + " " + t.title)
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
    );
  const editable = !!plan?.editable;
  const minimum = tasks.length
    ? Math.min(...tasks.map((t) => day(t.start_date)))
    : day(plan?.project.start_date || nowDate());
  const maximum = tasks.length
    ? Math.max(...tasks.map((t) => day(t.end_date)))
    : minimum + 20;
  const start = pan ?? minimum,
    days = Math.max(24, Math.min(730, maximum - start + 8)),
    width = days * scale,
    leftWidth = 490,
    rowHeight = 54;
  const duration = tasks.length ? maximum - minimum + 1 : 0,
    today = day(nowDate());
  const record = (
    kind: string,
    payload: Obj = {},
    action: string | null = null,
    result: Obj = {},
  ) => recorder.current?.record(kind, payload, action, result);
  live.current = {
    project_id: pid,
    view,
    zoom: scale,
    query,
    selected_task_id: selected,
    critical_path_visible: criticalOn,
    calendar_start: iso(start),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: {
      left: grid.current?.scrollLeft || 0,
      top: grid.current?.scrollTop || 0,
    },
    visible_tasks: visible
      .slice(0, 80)
      .map((t) => ({
        id: t.id,
        code: t.code,
        title: t.title,
        section: t.section,
        contractor_id: t.contractor_id,
        responsible_id: t.responsible_id,
        linear: t.linear,
        axis_id: t.axis_id,
        start_m: t.start_m,
        end_m: t.end_m,
        location: t.location,
        start: t.start_date,
        end: t.end_date,
        duration: t.duration_days,
        actual_start: t.actual_start,
        actual_end: t.actual_end,
        unit: t.unit,
        planned: t.planned,
        status: t.status,
        predecessors: t.predecessor_ids,
        version: t.version,
      })),
    visible_task_count: visible.length,
  };
  function applyPlan(value: Schedule) {
    setPlan(value);
    live.current = {
      ...live.current,
      visible_tasks: value.tasks.slice(0, 80),
      visible_task_count: value.tasks.length,
    };
  }
  async function bootstrap() {
    try {
      const me = await api("/auth/me");
      setUser(me);
      const p = (await api("/projects")).filter((project: Obj) => project.code !== "KSG-DEMO");
      setProjects(p);
      setPid((current) =>
        p.some((x: Obj) => x.id === current)
          ? current
          : p.find((x: Obj) => x.code === "KSG-CONSTRUCTION")?.id || p[0]?.id || "",
      );
    } catch {
      setUser(null);
    } finally {
      setBoot(false);
    }
  }
  useEffect(() => {
    void bootstrap();
  }, []);
  useEffect(() => {
    if (!pid || !user) return;
    let active = true;
    setPlan(null);
    setSelected("");
    setEditor(null);
    setUndo(null);
    setPan(null);
    setQuery("");
    setError("");
    setRecordStatus(EMPTY_STATUS);
    api(`/projects/${pid}/schedule`)
      .then((data) => {
        if (active) applyPlan(data);
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [pid, user?.id]);
  useEffect(() => {
    if (!pid || !user || !plan || plan.project_id !== pid) return;
    let active = true;
    const rec = new Recorder(
      pid,
      user.id,
      () =>
        live.current.project_id === pid
          ? live.current
          : { project_id: pid, view: "project.leave" },
      (status) => {
        if (active) setRecordStatus(status);
      },
    );
    recorder.current = rec;
    void rec.start();
    const visibility = () =>
      void rec
        .record(document.hidden ? "page.hidden" : "page.visible")
        .then(() => rec.flush());
    document.addEventListener("visibilitychange", visibility);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", visibility);
      void rec.stop();
      if (recorder.current === rec) recorder.current = null;
    };
  }, [pid, user?.id, plan?.project_id]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const node = document.querySelector<HTMLElement>('[data-editor="true"]');
    if (!node) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) {
        setPopup(null);
        setEditor(null);
        setDetail(null);
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [!!editor, !!popup, !!detail]);
  async function mutate(
    kind: string,
    path: string,
    method: string,
    body: Obj,
    old?: Task,
  ) {
    if (!recorder.current?.ready) {
      setError("Дождитесь подключения чёрного ящика перед изменением графика.");
      return;
    }
    const action = crypto.randomUUID();
    setBusy(true);
    setError("");
    await record("action.requested", { kind, ...body }, action);
    await recorder.current.flush();
    try {
      const response = await fetch(`/api/projects/${pid}${path}`, {
        method,
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Trace-Session": recorder.current.id,
          "X-Trace-Action": action,
        },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.detail || "Не удалось сохранить график");
      if (result.tasks) {
        const previousIds = new Set((plan?.tasks || []).map((task) => task.id));
        const changedTask = old
          ? result.tasks.find((task: Task) => task.id === old.id)
          : result.tasks.find((task: Task) => !previousIds.has(task.id));
        applyPlan(result);
        if (old) setUndo(old);
        await record(
          "action.succeeded",
          { kind, task_id: changedTask?.id || old?.id || null, code: changedTask?.code || null },
          action,
          { ok: true, task_id: changedTask?.id || old?.id || null },
        );
      } else {
        await record("action.succeeded", { kind }, action, { ok: true });
      }
      await recorder.current.flush();
      setEditor(null);
      setPopup(null);
      setPreview(null);
      setNotice("График сохранён");
      return result;
    } catch (e) {
      setError((e as Error).message);
      setPreview(null);
      await record("action.failed", { kind }, action, {
        ok: false,
        error: (e as Error).message,
      });
    } finally {
      setBusy(false);
    }
  }
  function selectTask(t: Task, edit = false) {
    setSelected(t.id);
    void record("selection.change", { task_id: t.id, code: t.code });
    if (edit) {
      setEditor({ ...inputTask(t), id: t.id });
      setError("");
    }
  }
  function newTask(startDate?: string) {
    const codes = new Set(tasks.map((t) => t.code));
    let n = 1;
    const code = (i: number) => String(i).padStart(2, "0");
    while (codes.has(code(n))) n++;
    const options = plan?.options;
    const axis = options?.axes[0];
    setSelected("");
    setEditor({
      code: code(n),
      title: "",
      section: "Основные работы",
      contractor_id: options?.contractors[0]?.id || "",
      responsible_id: user?.id || options?.responsibles[0]?.id || "",
      linear: !!axis,
      axis_id: axis?.id || null,
      start_m: axis?.start_m ?? null,
      end_m: axis ? Math.min(axis.start_m + 100, axis.end_m) : null,
      location: "",
      start_date: startDate || iso(start),
      duration_days: 1,
      actual_start: null,
      actual_end: null,
      unit: "м",
      planned: "100",
      status: "planned",
      reason: "",
      predecessor_ids: [],
      version: 1,
    });
    setError("");
    void record("ui.click", {
      target: "task.new",
      start_date: startDate || iso(start),
    });
  }
  function changeView(next: string) {
    void record("view.change", { from: view, to: next });
    setView(next);
    setError("");
    if (next === "recorder") void loadRecordings();
  }
  async function loadRecordings(sid = traceId || recorder.current?.id) {
    try {
      await recorder.current?.flush();
      const list = await api(`/projects/${pid}/recorder/sessions`);
      setSessions(list);
      const target = list.some((s: Obj) => s.id === sid) ? sid : list[0]?.id;
      if (target) {
        setTraceId(target);
        const data = await api(
          `/projects/${pid}/recorder/sessions/${target}/events?limit=500&latest=true`,
        );
        setEvents(data.items);
        setEventCount(data.total);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    if (view !== "recorder" || !pid) return;
    const timer = setInterval(() => void loadRecordings(), 5000);
    return () => clearInterval(timer);
  }, [view, pid, traceId]);
  async function exportTrace() {
    try {
      await record("export.requested", { session_id: traceId });
      await recorder.current?.flush();
      await recorder.current?.flush();
      const r = await fetch(
        `/api/projects/${pid}/recorder/sessions/${traceId}/export`,
      );
      if (!r.ok) throw new Error("Не удалось выгрузить запись");
      const blob = await r.blob(),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = `ksg-session-${traceId}.jsonl`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("JSONL выгружен");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function onDragStart(e: React.PointerEvent, task: Task, mode: string) {
    if (!editable || busy || !recordStatus.ready || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(task.id);
    drag.current = {
      task,
      mode,
      x: e.clientX,
      y: e.clientY,
      time: performance.now(),
      samples: [[0, 0, 0]],
      delta: 0,
    };
  }
  function onDragMove(e: React.PointerEvent) {
    const g = drag.current;
    if (!g) return;
    const delta = Math.round((e.clientX - g.x) / scale);
    g.delta = delta;
    if (g.samples.length < 100)
      g.samples.push([
        Math.round(e.clientX - g.x),
        Math.round(e.clientY - g.y),
        Math.round(performance.now() - g.time),
      ]);
    let begin = g.task.start_date,
      duration = g.task.duration_days;
    if (g.mode === "move") begin = shift(begin, delta);
    else if (g.mode === "end") duration = Math.max(1, duration + delta);
    else {
      const d = Math.min(delta, duration - 1);
      begin = shift(begin, d);
      duration -= d;
    }
    setPreview({
      id: g.task.id,
      start_date: begin,
      end_date: shift(begin, duration - 1),
      duration_days: duration,
    });
  }
  function onDragEnd(e: React.PointerEvent) {
    const g = drag.current;
    if (!g) return;
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* Capture may already be released. */
    }
    const delta = Math.round((e.clientX - g.x) / scale);
    if (!delta) {
      setPreview(null);
      return;
    }
    lastDrag.current = performance.now();
    let begin = g.task.start_date,
      duration = g.task.duration_days;
    if (g.mode === "move") begin = shift(begin, delta);
    else if (g.mode === "end") duration = Math.max(1, duration + delta);
    else {
      const d = Math.min(delta, duration - 1);
      begin = shift(begin, d);
      duration -= d;
    }
    void record("gesture", {
      task_id: g.task.id,
      operation: g.mode,
      delta_days: delta,
      path: g.samples,
      elapsed_ms: Math.round(performance.now() - g.time),
      from: { start: g.task.start_date, duration: g.task.duration_days },
      to: { start: begin, duration },
    });
    void mutate(
      g.mode === "move" ? "task.move" : "task.resize",
      `/schedule/tasks/${g.task.id}`,
      "PUT",
      { ...inputTask(g.task), start_date: begin, duration_days: duration },
      g.task,
    );
  }
  const display = (t: Task) =>
    preview?.id === t.id ? { ...t, ...preview } : t;
  const daysList = Array.from({ length: days }, (_, i) => start + i);
  const months: { label: string; offset: number; count: number }[] = [];
  daysList.forEach((d, i) => {
    const label = new Date(d * 86400000).toLocaleDateString("ru-RU", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    const last = months[months.length - 1];
    if (last?.label === label) last.count++;
    else months.push({ label, offset: i, count: 1 });
  });
  const trackClick = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      "button,[data-track]",
    );
    if (target)
      void record("ui.click", {
        target:
          target.dataset.track ||
          target.getAttribute("aria-label") ||
          target.textContent?.trim().slice(0, 120) ||
          "control",
        task_id: target.dataset.taskId || null,
      });
  };

  if (boot) return <div className="ksg-boot">Открываем график…</div>;
  if (!user)
    return (
      <div className="ksg-login">
        <div className="login-brand">
          <span className="brand-mark">
            <CalendarDays size={24} />
          </span>
          <b>КСГ</b>
          <span>Контрольно-сетевой график</span>
        </div>
        <div className="login-card">
          <div className="login-example">
            <div className="mini-ruler">1　2　3　4　5　6　7　8</div>
            {[6, 2, 3, 5].map((n, i) => (
              <div key={i}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <i style={{ width: n * 28, marginLeft: i > 1 ? 168 : 0 }} />
              </div>
            ))}
          </div>
          <h1>Работы. Сроки. Связи.</h1>
          <p>
            Диаграмма Ганта и сетевой график.
            <br />
            Действия в графике сохраняются в чёрный ящик.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              api("/auth/login", "POST", login)
                .then(bootstrap)
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            <label>
              Логин
              <input
                name="email"
                type="email"
                value={login.email}
                onChange={(e) => setLogin({ ...login, email: e.target.value })}
                required
                autoComplete="username"
              />
            </label>
            <label>
              Пароль
              <input
                name="password"
                type="password"
                value={login.password}
                onChange={(e) =>
                  setLogin({ ...login, password: e.target.value })
                }
                required
                autoComplete="current-password"
              />
            </label>
            {error && (
              <div className="ksg-error" role="alert">
                {error}
              </div>
            )}
            <button className="ksg-primary full" disabled={busy}>
              Открыть график <ArrowRight size={16} />
            </button>
          </form>
          <div className="demo-accounts">
            <span className="demo-accounts-label">Быстрый вход для демо:</span>
            <div className="demo-buttons">
              <button
                type="button"
                className="demo-account-btn"
                disabled={busy}
                onClick={() => {
                  const creds = {
                    email: "planner@demo.local",
                    password: "d7502a427c346a41a47a66f554b9b8a2d5069bbd1b952e26",
                  };
                  setLogin(creds);
                  setBusy(true);
                  api("/auth/login", "POST", creds)
                    .then(bootstrap)
                    .catch((e) => setError(e.message))
                    .finally(() => setBusy(false));
                }}
              >
                <b>Мария Соколова</b> · Планировщик (создание, связывание, расчёт)
              </button>
              <button
                type="button"
                className="demo-account-btn"
                disabled={busy}
                onClick={() => {
                  const creds = {
                    email: "inspector@demo.local",
                    password: "d7502a427c346a41a47a66f554b9b8a2d5069bbd1b952e26",
                  };
                  setLogin(creds);
                  setBusy(true);
                  api("/auth/login", "POST", creds)
                    .then(bootstrap)
                    .catch((e) => setError(e.message))
                    .finally(() => setBusy(false));
                }}
              >
                <b>Дмитрий Орлов</b> · Инспектор стройконтроля (только чтение)
              </button>
            </div>
          </div>
          <small>Запись начинается после входа. Пароль не записывается.</small>
        </div>
      </div>
    );
  return (
    <div
      className="planner-shell"
      onClickCapture={trackClick}
      onFocusCapture={(e) => {
        const t = e.target as HTMLInputElement;
        if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))
          void record("field.focus", {
            field: t.name || t.getAttribute("aria-label") || "field",
          });
      }}
      onBlurCapture={(e) => {
        const t = e.target as HTMLInputElement;
        if (
          ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) &&
          t.type !== "password"
        )
          void record("field.commit", {
            field: t.name || t.getAttribute("aria-label") || "field",
            value: t.value.slice(0, 2000),
          });
      }}
    >
      <header className="ksg-header">
        <div className="ksg-logo">
          <span className="brand-mark">
            <CalendarDays size={21} />
          </span>
          <b>КСГ</b>
          <span className="logo-divider" />
          <span>Контрольно-сетевой график</span>
        </div>
        <div className="project-switch">
          <select
            name="project"
            aria-label="График"
            value={pid}
            onChange={(e) => {
              void record("selection.change", {
                target: "project",
                from: pid,
                to: e.target.value,
              });
              setPid(e.target.value);
            }}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </div>
        <div className="profile">
          <div className="profile-info">
            <span className="profile-name">{user.name}</span>
            <span
              className={`profile-badge ${
                user.email === "planner@demo.local" || editable
                  ? "badge-planner"
                  : user.email === "inspector@demo.local"
                  ? "badge-inspector"
                  : user.email === "admin@demo.local"
                  ? "badge-admin"
                  : user.email === "customer@demo.local"
                  ? "badge-customer"
                  : user.email === "contractor@demo.local"
                  ? "badge-contractor"
                  : "badge-inspector"
              }`}
            >
              {user.email === "planner@demo.local" || editable
                ? "Планировщик · Редактирование КСГ"
                : user.email === "inspector@demo.local"
                ? "Инспектор · Только чтение"
                : user.email === "admin@demo.local"
                ? "Администратор · Управление"
                : user.email === "customer@demo.local"
                ? "Заказчик · Просмотр и приёмка"
                : user.email === "contractor@demo.local"
                ? "Генподрядчик · Исполнение"
                : "Только чтение"}
            </span>
          </div>
          <button
            className="ksg-icon"
            title="Выйти из системы"
            aria-label="Выйти"
            onClick={async () => {
              await recorder.current?.stop();
              await api("/auth/logout", "POST");
              setUser(null);
              setPlan(null);
              setPid("");
              setLogin({ ...login, password: "" });
            }}
          >
            <LogOut size={17} />
          </button>
        </div>
      </header>
      <div className="ksg-tabs">
        <div>
          {[
            ["gantt", "Диаграмма Ганта", CalendarDays],
            ["network", "Сетевой график", GitBranch],
            ["recorder", "Чёрный ящик", Activity],
          ].map(([key, title, Icon]: any) => (
            <button
              key={key}
              className={view === key ? "active" : ""}
              onClick={() => changeView(key)}
            >
              <Icon size={16} />
              {title}
              {key === "recorder" && <span className="tab-tag">REC</span>}
            </button>
          ))}
        </div>
        <button
          className={`rec-indicator ${recordStatus.error ? "bad" : ""}`}
          onClick={() => changeView("recorder")}
          title={recordStatus.error || "Действия внутри графика записываются"}
        >
          <i />
          {recordStatus.error
            ? "Ошибка отправки записи"
            : recordStatus.ready
              ? "Запись действий включена"
              : "Подключаем запись…"}
          {recordStatus.pending > 0 && (
            <span> · в очереди {recordStatus.pending}</span>
          )}
        </button>
      </div>
      <main className="ksg-main">
        {error && (
          <div className="ksg-error" role="alert">
            <TriangleAlert size={16} />
            <span>{error}</span>
            <button
              className="ksg-icon"
              aria-label="Закрыть ошибку"
              onClick={() => setError("")}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {!pid ? (
          <div className="ksg-empty">
            Нет доступных графиков для этого пользователя.
          </div>
        ) : !plan ? (
          <div className="ksg-empty">Загрузка графика…</div>
        ) : (
          <>
            <div className="board-heading">
              <div className="board-title-group">
                <h1>{plan.project.name}</h1>
                <div className="board-stats-chips">
                  <span className="stats-chip">{tasks.length} работ</span>
                  <span className="stats-chip">{duration} дн.</span>
                  <span className="stats-chip">{plan.links.length} связей</span>
                </div>
              </div>
              <button
                className="ksg-button new-project compact"
                onClick={() =>
                  setPopup({
                    kind: "project",
                    name: "Новый график",
                    start_date: nowDate(),
                  })
                }
                disabled={
                  !editable &&
                  !(projects.find((p) => p.id === pid)?.roles || []).includes(
                    "ProjectAdmin",
                  )
                }
              >
                <Plus size={15} />
                Новый график
              </button>
            </div>
            {view !== "recorder" && !editable && (
              <div className="readonly-banner">
                <ShieldCheck size={16} />
                <span>
                  Режим <b>«Только чтение»</b> ({user.name}). Создание, редактирование и связывание работ доступны роли <b>«Планировщик»</b> (Мария Соколова).
                </span>
              </div>
            )}
            {view !== "recorder" && (
              <div className="ksg-toolbar">
                <div className="toolbar-group">
                  <button
                    className="ksg-primary"
                    onClick={() => newTask()}
                    disabled={!editable || busy || !recordStatus.ready}
                  >
                    <Plus size={16} />
                    Работа
                  </button>
                  <button
                    className="ksg-button"
                    onClick={() =>
                      setPopup({
                        kind: "link",
                        from: tasks[0]?.id || "",
                        to: selected || tasks[1]?.id || "",
                      })
                    }
                    disabled={!editable || busy || tasks.length < 2}
                  >
                    <Link2 size={15} />
                    Связать
                  </button>
                  <button
                    className="ksg-button"
                    onClick={() =>
                      setPopup({
                        kind: "calculate",
                        start_date: plan.project.start_date,
                      })
                    }
                    disabled={!editable || busy || !tasks.length}
                  >
                    <RefreshCw size={14} />
                    Рассчитать по связям
                  </button>
                  <button
                    className="ksg-icon"
                    title="Отменить последнее изменение работы"
                    aria-label="Отменить изменение"
                    disabled={!undo || busy || !editable}
                    onClick={() => {
                      if (!undo) return;
                      const current = byId.get(undo.id);
                      if (current)
                        void mutate(
                          "task.undo",
                          `/schedule/tasks/${undo.id}`,
                          "PUT",
                          { ...inputTask(undo), version: current.version },
                          current,
                        );
                    }}
                  >
                    <ArrowLeft size={16} />
                  </button>
                </div>
                <div className="toolbar-group right">
                  <div className="ksg-search">
                    <Search size={14} />
                    <input
                      aria-label="Поиск работ"
                      name="search"
                      placeholder="Найти работу"
                      value={query}
                      onChange={(e) => {
                        const value = e.target.value;
                        setQuery(value);
                        clearTimeout(searchTimer.current);
                        searchTimer.current = setTimeout(
                          () => void record("filter.change", { query: value }),
                          350,
                        );
                      }}
                    />
                  </div>
                  {view === "gantt" && (
                    <>
                      <button
                        className="ksg-icon"
                        aria-label="Предыдущая неделя"
                        onClick={() => {
                          setPan(start - 7);
                          void record("scroll", {
                            calendar_start: iso(start - 7),
                            method: "previous_week",
                          });
                        }}
                      >
                        <ArrowLeft size={14} />
                      </button>
                      <button
                        className="ksg-button compact"
                        onClick={() => {
                          setPan(null);
                          if (grid.current) grid.current.scrollLeft = 0;
                          void record("zoom.change", { method: "fit_project" });
                        }}
                      >
                        Весь график
                      </button>
                      <button
                        className="ksg-icon"
                        aria-label="Следующая неделя"
                        onClick={() => {
                          setPan(start + 7);
                          void record("scroll", {
                            calendar_start: iso(start + 7),
                            method: "next_week",
                          });
                        }}
                      >
                        <ArrowRight size={14} />
                      </button>
                      <select
                        aria-label="Масштаб"
                        name="zoom"
                        value={scale}
                        onChange={(e) => {
                          setScale(Number(e.target.value));
                          void record("zoom.change", {
                            from: scale,
                            to: Number(e.target.value),
                          });
                        }}
                      >
                        <option value={44}>Дни</option>
                        <option value={28}>Компактно</option>
                        <option value={18}>Недели</option>
                      </select>
                    </>
                  )}
                </div>
              </div>
            )}
            {view !== "recorder" && (
              <div className="board-meta">
                <div>
                  <span className="legend normal" />
                  Работа <span className="legend critical" />
                  Критический путь{" "}
                  <label className="critical-toggle">
                    <input
                      type="checkbox"
                      checked={criticalOn}
                      onChange={(e) => {
                        setCriticalOn(e.target.checked);
                        void record("view.change", {
                          critical_path: e.target.checked,
                        });
                      }}
                    />
                    Показать
                  </label>
                </div>
                <span>
                  {metrics.conflicts.length ? (
                    <span className="conflict-label">
                      <TriangleAlert size={13} />
                      {metrics.conflicts.length} нарушений связей
                    </span>
                  ) : (
                    <span className="links-ok">
                      <Check size={13} />
                      Связи согласованы
                    </span>
                  )}
                  <span className="meta-divider">·</span>Расчётный минимум:{" "}
                  <b>{metrics.duration} дн.</b>
                </span>
              </div>
            )}
            {view === "gantt" && (
              <section className="gantt-surface">
                <div
                  className="gantt-scroll"
                  ref={grid}
                  onScroll={() => {
                    clearTimeout(scrollTimer.current);
                    scrollTimer.current = setTimeout(
                      () =>
                        void record("scroll", {
                          left: grid.current?.scrollLeft || 0,
                          top: grid.current?.scrollTop || 0,
                          method: "scrollbar",
                        }),
                      300,
                    );
                  }}
                >
                  <div
                    className="gantt-content"
                    style={{ width: leftWidth + width, minWidth: "100%" }}
                  >
                    <div className="gantt-head">
                      <div className="task-head" style={{ width: leftWidth }}>
                        <span />
                        <span>Код</span>
                        <span>Работа</span>
                        <span>Дней</span>
                        <span>Предшественники</span>
                      </div>
                      <div className="time-head" style={{ width }}>
                        <div className="months">
                          {months.map((m) => (
                            <span
                              key={m.label + ":" + m.offset}
                              style={{
                                left: m.offset * scale,
                                width: m.count * scale,
                              }}
                            >
                              {m.label}
                            </span>
                          ))}
                        </div>
                        <div className="days">
                          {daysList.map((d, i) => {
                            const dt = new Date(d * 86400000),
                              weekend = [0, 6].includes(dt.getUTCDay());
                            return (
                              <div
                                key={d}
                                className={`${weekend ? "weekend" : ""} ${d === today ? "today" : ""}`}
                                style={{ width: scale, left: i * scale }}
                              >
                                {scale >= 28 || dt.getUTCDay() === 1 ? (
                                  <b>{dt.getUTCDate()}</b>
                                ) : null}
                                {scale >= 36 && (
                                  <small>
                                    {
                                      [
                                        "вс",
                                        "пн",
                                        "вт",
                                        "ср",
                                        "чт",
                                        "пт",
                                        "сб",
                                      ][dt.getUTCDay()]
                                    }
                                  </small>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <div
                      className="gantt-body"
                      style={{
                        minHeight: Math.max(324, visible.length * rowHeight),
                      }}
                    >
                      {visible.map((source, index) => {
                        const t = display(source),
                          isCritical = criticalOn && metrics.critical.has(t.id),
                          conflict = metrics.conflicts.some(
                            (c) => c.to === t.id,
                          );
                        return (
                          <div
                            className={`gantt-row ${selected === t.id ? "selected" : ""}`}
                            style={{ height: rowHeight }}
                            key={t.id}
                          >
                            <div
                              className="task-cells"
                              style={{ width: leftWidth }}
                              onClick={() => selectTask(source)}
                              onDoubleClick={() => selectTask(source, true)}
                              data-track="task.row"
                              data-task-id={t.id}
                            >
                              <span className="row-number">{index + 1}</span>
                              <b className="task-code">{t.code}</b>
                              <button
                                className="task-title"
                                title={`${t.title}\n${t.planned} ${t.unit} · ${t.linear ? `${t.start_m ?? "—"}–${t.end_m ?? "—"} м` : t.location || "Место не указано"} · ${statusNames[t.status]}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  selectTask(source, true);
                                }}
                              >
                                <span>{t.title}</span>
                                <small>
                                  {t.planned} {t.unit} · {t.linear
                                    ? `${t.start_m ?? "—"}–${t.end_m ?? "—"} м`
                                    : t.location || "Место не указано"} · {statusNames[t.status]}
                                </small>
                              </button>
                              <span className="task-duration">
                                {t.duration_days}
                              </span>
                              <span className="task-preds">
                                {t.predecessor_ids
                                  .map((p: string) => byId.get(p)?.code)
                                  .filter(Boolean)
                                  .join(", ") || "—"}
                              </span>
                            </div>
                            <div
                              className="timeline-row"
                              style={{
                                width,
                                backgroundSize: `${scale}px 100%`,
                              }}
                              onDoubleClick={(e) => {
                                if (editable && e.target === e.currentTarget) {
                                  const rect =
                                    e.currentTarget.getBoundingClientRect();
                                  newTask(
                                    iso(
                                      start +
                                        Math.floor(
                                          (e.clientX - rect.left) / scale,
                                        ),
                                    ),
                                  );
                                }
                              }}
                            >
                              {daysList
                                .filter((d) =>
                                  [0, 6].includes(
                                    new Date(d * 86400000).getUTCDay(),
                                  ),
                                )
                                .map((d) => (
                                  <i
                                    className="weekend-cell"
                                    key={d}
                                    style={{
                                      left: (d - start) * scale,
                                      width: scale,
                                    }}
                                  />
                                ))}
                              <div
                                className={`gantt-bar ${isCritical ? "is-critical" : ""} ${conflict ? "has-conflict" : ""} ${preview?.id === t.id ? "dragging" : ""}`}
                                style={{
                                  left: (day(t.start_date) - start) * scale + 2,
                                  width: Math.max(
                                    6,
                                    t.duration_days * scale - 4,
                                  ),
                                }}
                                role="button"
                                tabIndex={0}
                                aria-label={`Работа ${t.code}: ${t.title}, ${t.duration_days} дней`}
                                data-track="task.bar"
                                data-task-id={t.id}
                                title={`${t.code} · ${t.title}\n${dateLabel(t.start_date)} — ${dateLabel(t.end_date)} · ${t.duration_days} дн.\n${editable ? "Перетащите для переноса. Стрелки ← → сдвигают на день." : ""}`}
                                onPointerDown={(e) =>
                                  onDragStart(e, source, "move")
                                }
                                onPointerMove={onDragMove}
                                onPointerUp={onDragEnd}
                                onPointerCancel={() => {
                                  drag.current = null;
                                  setPreview(null);
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (
                                    performance.now() - lastDrag.current >
                                    250
                                  )
                                    selectTask(source);
                                }}
                                onDoubleClick={(e) => {
                                  e.stopPropagation();
                                  selectTask(source, true);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    selectTask(source, true);
                                  if (
                                    editable &&
                                    !busy &&
                                    ["ArrowLeft", "ArrowRight"].includes(e.key)
                                  ) {
                                    e.preventDefault();
                                    const delta =
                                      e.key === "ArrowLeft" ? -1 : 1;
                                    void record("gesture", {
                                      task_id: t.id,
                                      operation: "keyboard_move",
                                      delta_days: delta,
                                    });
                                    void mutate(
                                      "task.move",
                                      `/schedule/tasks/${t.id}`,
                                      "PUT",
                                      {
                                        ...inputTask(source),
                                        start_date: shift(
                                          source.start_date,
                                          delta,
                                        ),
                                      },
                                      source,
                                    );
                                  }
                                }}
                              >
                                {editable && (
                                  <span
                                    className="bar-handle start"
                                    aria-label={`Начало ${t.code}`}
                                    onPointerDown={(e) =>
                                      onDragStart(e, source, "start")
                                    }
                                  />
                                )}
                                {t.duration_days * scale > 42 && (
                                  <span className="bar-label">
                                    <span>{t.title}</span>
                                    <small>{t.duration_days} дн.</small>
                                  </span>
                                )}
                                {editable && (
                                  <span
                                    className="bar-handle end"
                                    aria-label={`Длительность ${t.code}`}
                                    onPointerDown={(e) =>
                                      onDragStart(e, source, "end")
                                    }
                                  />
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <svg
                        className="dependency-overlay"
                        style={{
                          left: leftWidth,
                          width,
                          height: Math.max(324, visible.length * rowHeight),
                        }}
                        aria-label="Связи между работами"
                      >
                        <defs>
                          <marker
                            id="gantt-arrow"
                            markerWidth="7"
                            markerHeight="7"
                            refX="5"
                            refY="3.5"
                            orient="auto"
                          >
                            <path d="M0 0 L7 3.5 L0 7" fill="#475569" />
                          </marker>
                          <marker
                            id="gantt-warning"
                            markerWidth="7"
                            markerHeight="7"
                            refX="5"
                            refY="3.5"
                            orient="auto"
                          >
                            <path d="M0 0 L7 3.5 L0 7" fill="#dc2626" />
                          </marker>
                        </defs>
                        {plan.links.map((link) => {
                          const a = visible.findIndex(
                              (t) => t.id === link.from,
                            ),
                            b = visible.findIndex((t) => t.id === link.to);
                          if (a < 0 || b < 0) return null;
                          const from = display(visible[a]),
                            to = display(visible[b]),
                            sx = (day(from.end_date) - start + 1) * scale - 1,
                            tx = (day(to.start_date) - start) * scale,
                            sy = a * rowHeight + rowHeight / 2,
                            ty = b * rowHeight + rowHeight / 2;
                          const warning =
                            day(to.start_date) <= day(from.end_date);
                          const d =
                            tx - sx > 14
                              ? `M${sx} ${sy} H${sx + 10} V${ty} H${tx - 3}`
                              : `M${sx} ${sy} H${sx + 10} V${sy + 22} H${tx - 10} V${ty} H${tx - 3}`;
                          return (
                            <path
                              key={link.id}
                              d={d}
                              fill="none"
                              stroke={warning ? "#dc2626" : "#475569"}
                              strokeWidth={1.8}
                              strokeLinejoin="round"
                              markerEnd={`url(#${warning ? "gantt-warning" : "gantt-arrow"})`}
                            />
                          );
                        })}
                        {today >= start && today < start + days && (
                          <line
                            className="today-line"
                            x1={(today - start) * scale + scale / 2}
                            x2={(today - start) * scale + scale / 2}
                            y1={0}
                            y2={Math.max(324, visible.length * rowHeight)}
                          />
                        )}
                      </svg>
                      {!visible.length && (
                        <div
                          className="empty-chart"
                          style={{ left: leftWidth }}
                        >
                          Нет работ
                          {query
                            ? " по этому запросу"
                            : ". Добавьте первую работу в график."}
                        </div>
                      )}
                    </div>
                    {editable && (
                      <button
                        className="add-row"
                        style={{ width: leftWidth }}
                        onClick={() => newTask()}
                        disabled={busy || !recordStatus.ready}
                      >
                        <Plus size={15} />
                        Добавить работу
                      </button>
                    )}
                  </div>
                </div>
                <div className="gantt-footer">
                  <span>
                    {dateLabel(iso(start))} — {dateLabel(iso(start + days - 1))}{" "}
                    <span>·</span> календарные дни, выходные выделены
                  </span>
                  <span>
                    <GripVertical size={13} /> Перенос — за полосу ·
                    длительность — за край
                  </span>
                </div>
              </section>
            )}
            {view === "network" &&
              (() => {
                const levels = new Map<number, Task[]>();
                visible.forEach((t) =>
                  levels.set(metrics.rank.get(t.id) || 0, [
                    ...(levels.get(metrics.rank.get(t.id) || 0) || []),
                    t,
                  ]),
                );
                const maxRows = Math.max(
                    1,
                    ...[...levels.values()].map((v) => v.length),
                  ),
                  positions = new Map<string, { x: number; y: number }>();
                levels.forEach((list, rank) =>
                  list.forEach((t, i) =>
                    positions.set(t.id, {
                      x: 40 + rank * 235,
                      y: 45 + (maxRows - list.length) * 53 + i * 106,
                    }),
                  ),
                );
                const svgWidth = Math.max(
                    980,
                    (Math.max(0, ...levels.keys()) + 1) * 235 + 50,
                  ),
                  svgHeight = Math.max(380, maxRows * 106 + 100);
                return (
                  <section className="network-surface">
                    <div className="network-caption">
                      <GitBranch size={17} />
                      <span>
                        Работы связаны по правилу «окончание → начало»
                      </span>
                      <small>Двойной клик по работе — редактировать</small>
                    </div>
                    <div className="network-scroll">
                      <svg
                        width={svgWidth}
                        height={svgHeight}
                        aria-label="Сетевая схема работ"
                      >
                        <defs>
                          <marker
                            id="net-arrow"
                            markerUnits="userSpaceOnUse"
                            viewBox="0 0 12 12"
                            markerWidth="12"
                            markerHeight="12"
                            refX="1"
                            refY="6"
                            orient="auto"
                          >
                            <path d="M1 1 L11 6 L1 11 Z" fill="#64748b" />
                          </marker>
                          <marker
                            id="net-arrow-critical"
                            markerUnits="userSpaceOnUse"
                            viewBox="0 0 12 12"
                            markerWidth="12"
                            markerHeight="12"
                            refX="1"
                            refY="6"
                            orient="auto"
                          >
                            <path d="M1 1 L11 6 L1 11 Z" fill="#dc2626" />
                          </marker>
                        </defs>
                        {(() => {
                          const fromMap = new Map<string, typeof plan.links>();
                          const toMap = new Map<string, typeof plan.links>();
                          plan.links.forEach((l) => {
                            if (positions.has(l.from) && positions.has(l.to)) {
                              fromMap.set(l.from, [...(fromMap.get(l.from) || []), l]);
                              toMap.set(l.to, [...(toMap.get(l.to) || []), l]);
                            }
                          });
                          fromMap.forEach((list) =>
                            list.sort(
                              (x, y) => positions.get(x.to)!.y - positions.get(y.to)!.y,
                            ),
                          );
                          toMap.forEach((list) =>
                            list.sort(
                              (x, y) => positions.get(x.from)!.y - positions.get(y.from)!.y,
                            ),
                          );
                          const allNodes = [...positions.entries()].map(([id, pos]) => ({
                            id,
                            ...pos,
                          }));
                          const orderedLinks = plan.links
                            .filter((link) => positions.has(link.from) && positions.has(link.to))
                            .sort((left, right) => {
                              const leftSpan = positions.get(left.to)!.x - positions.get(left.from)!.x;
                              const rightSpan = positions.get(right.to)!.x - positions.get(right.from)!.x;
                              return leftSpan - rightSpan;
                            });
                          const routedSegments: NetworkSegment[] = [];

                          return orderedLinks.map((l) => {
                            const a = positions.get(l.from),
                              b = positions.get(l.to);
                            if (!a || !b) return null;
                            const critical =
                              criticalOn &&
                              metrics.critical.has(l.from) &&
                              metrics.critical.has(l.to);

                            const outList = fromMap.get(l.from) || [l];
                            const inList = toMap.get(l.to) || [l];
                            const outIdx = outList.indexOf(l);
                            const inIdx = inList.indexOf(l);
                            const syOffset =
                              outList.length > 1
                                ? (outIdx - (outList.length - 1) / 2) * 14
                                : 0;
                            const tyOffset =
                              inList.length > 1
                                ? (inIdx - (inList.length - 1) / 2) * 14
                                : 0;

                            const sx = a.x + 180,
                              sy = a.y + 35 + syOffset,
                              tx = b.x,
                              ty = b.y + 35 + tyOffset,
                              endX = tx - 14;

                            const obstacles = allNodes.filter(
                              (p) =>
                                p.id !== l.from &&
                                p.id !== l.to &&
                                p.x > a.x + 50 &&
                                p.x + 180 < b.x - 20,
                            );

                            const points = networkLinkPoints(
                              sx,
                              sy,
                              endX,
                              ty,
                              obstacles,
                              routedSegments,
                            );
                            for (let i = 1; i < points.length; i++) {
                              if (
                                Math.abs(points[i][0] - points[i - 1][0]) +
                                  Math.abs(points[i][1] - points[i - 1][1]) <
                                0.1
                              )
                                continue;
                              routedSegments.push({
                                from: points[i - 1],
                                to: points[i],
                              });
                            }
                            const d = roundedOrthogonalPath(points);

                            return (
                              <path
                                key={l.id}
                                d={d}
                                fill="none"
                                stroke={critical ? "#dc2626" : "#64748b"}
                                strokeWidth={critical ? 2.4 : 1.8}
                                strokeLinejoin="round"
                                markerEnd={`url(#${critical ? "net-arrow-critical" : "net-arrow"})`}
                              />
                            );
                          });
                        })()}
                        {visible.map((t) => {
                          const p = positions.get(t.id)!;
                          return (
                            <g
                              key={t.id}
                              transform={`translate(${p.x},${p.y})`}
                              className={`network-node ${criticalOn && metrics.critical.has(t.id) ? "critical" : ""} ${selected === t.id ? "selected" : ""}`}
                              role="button"
                              tabIndex={0}
                              aria-label={`Работа ${t.code}: ${t.title}`}
                              onClick={() => selectTask(t)}
                              onDoubleClick={() => selectTask(t, true)}
                              onKeyDown={(e) =>
                                e.key === "Enter" && selectTask(t, true)
                              }
                            >
                              <rect width={180} height={70} rx={7} />
                              <text className="node-code" x={14} y={26}>
                                {t.code}
                              </text>
                              <text
                                className="node-duration"
                                x={166}
                                y={26}
                                textAnchor="end"
                              >
                                {t.duration_days} дн.
                              </text>
                              <text className="node-title" x={14} y={50}>
                                {t.title.length > 23
                                  ? t.title.slice(0, 22) + "…"
                                  : t.title}
                              </text>
                            </g>
                          );
                        })}
                      </svg>
                    </div>
                    <div className="network-bottom">
                      Критический путь:{" "}
                      <b>
                        {tasks
                          .filter((t) => metrics.critical.has(t.id))
                          .map((t) => t.code)
                          .join(" → ") || "—"}
                      </b>
                      <span>
                        {metrics.duration} календарных дней по длительностям и
                        связям
                      </span>
                    </div>
                  </section>
                );
              })()}
            {view === "recorder" && (
              <section className="recorder-page">
                <div className="recorder-intro">
                  <span className="blackbox-icon">
                    <Square size={22} />
                  </span>
                  <div>
                    <h2>Чёрный ящик</h2>
                    <p>
                      Сессии пользователя: контекст → действие → результат.
                      Изменения графика сохраняются со снимками до и после.
                    </p>
                  </div>
                  <div className="recording-count">
                    <b>{eventCount}</b>
                    <span>событий в сессии</span>
                  </div>
                </div>
                <div className="recorder-tools">
                  <label>
                    Сессия
                    <select
                      name="session"
                      value={traceId}
                      onChange={(e) => {
                        setTraceId(e.target.value);
                        void loadRecordings(e.target.value);
                      }}
                    >
                      {sessions.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.mode === "api" ? "API" : s.mode === "human" ? "Пользователь" : "Архив"}{" "}
                          · {new Date(s.created_at).toLocaleString("ru-RU")} ·{" "}
                          {s.id.slice(0, 8)} · {s.event_count} событий
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="ksg-button"
                    onClick={() => void loadRecordings()}
                  >
                    <RefreshCw size={15} />
                    Обновить
                  </button>
                  <button
                    className="ksg-primary"
                    onClick={() => void exportTrace()}
                    disabled={!traceId}
                  >
                    <Download size={15} />
                    Выгрузить JSONL
                  </button>
                </div>
                <div className="recording-explainer">
                  <ShieldCheck size={18} />
                  <p>
                    Записываются действия только внутри КСГ: создание работ,
                    сроки, статус, объём, пикетаж, ответственные и связи. Для
                    изменений сохраняются пользователь, время и состояние до
                    и после. Пароли и действия в других приложениях не собираются.
                  </p>
                </div>
                <div className="trace-table-scroll">
                  <table className="trace-table">
                    <thead>
                      <tr>
                        <th>№</th>
                        <th>Время</th>
                        <th>Событие</th>
                        <th>Источник</th>
                        <th>Действие / результат</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {events.map((e) => (
                        <tr key={e.id}>
                          <td>{e.origin === "client" ? e.client_seq : "—"}</td>
                          <td>
                            {new Date(
                              e.client_at || e.received_at,
                            ).toLocaleString("ru-RU", {
                              dateStyle: "short",
                              timeStyle: "medium",
                            })}
                          </td>
                          <td>
                            <b>{eventLabel(e)}</b>
                            <small>{e.kind}</small>
                          </td>
                          <td>
                            <span className={`origin ${e.origin}`}>
                              {e.origin === "server" ? "Сервер" : "Интерфейс"}
                            </span>
                          </td>
                          <td>
                            {eventSummary(e)}
                            {e.result.ok === true && (
                              <span className="success-word"> · успешно</span>
                            )}
                          </td>
                          <td>
                            <button
                              className="ksg-link"
                              onClick={() => setDetail(e)}
                            >
                              Открыть
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!events.length && (
                    <div className="ksg-empty">
                      События появятся после отправки очереди.
                    </div>
                  )}
                </div>
                <div className="trace-foot">
                  <span>
                    Показано {events.length} из {eventCount}. В выгрузку входят
                    все события выбранной сессии. Новые события сверху,
                    обновление каждые 5 секунд.
                  </span>
                  <span>Формат: aksg.behavior.v1</span>
                </div>
                <p className="training-note">
                  Это запись поведения для последующей подготовки обучающих
                  примеров. Обучение модели на этом этапе не запускается.
                </p>
              </section>
            )}
          </>
        )}
      </main>
      {editor && (
        <aside className="task-editor" data-editor="true">
          <div className="editor-heading">
            <div>
              <span className="eyebrow">РАБОТА В ГРАФИКЕ</span>
              <h2>{editor.id ? `Работа ${editor.code}` : "Новая работа"}</h2>
            </div>
            <button
              className="ksg-icon"
              aria-label="Закрыть карточку"
              onClick={() => setEditor(null)}
              disabled={busy}
            >
              <X size={18} />
            </button>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const original = editor.id ? byId.get(editor.id) : undefined;
              void mutate(
                original ? "task.update" : "task.create",
                `/schedule/tasks${original ? "/" + original.id : ""}`,
                original ? "PUT" : "POST",
                {
                  code: editor.code,
                  title: editor.title,
                  section: editor.section,
                  contractor_id: editor.contractor_id || null,
                  responsible_id: editor.responsible_id || null,
                  linear: !!editor.linear,
                  axis_id: editor.linear ? editor.axis_id || null : null,
                  start_m: editor.linear && editor.start_m !== "" && editor.start_m != null
                    ? Number(editor.start_m)
                    : null,
                  end_m: editor.linear && editor.end_m !== "" && editor.end_m != null
                    ? Number(editor.end_m)
                    : null,
                  location: editor.linear ? "" : editor.location,
                  start_date: editor.start_date,
                  duration_days: Number(editor.duration_days),
                  actual_start: editor.actual_start || null,
                  actual_end: editor.actual_end || null,
                  unit: editor.unit,
                  planned: String(editor.planned),
                  status: editor.status,
                  reason: editor.reason || "",
                  predecessor_ids: editor.predecessor_ids,
                  version: editor.version,
                },
                original,
              );
            }}
          >
            <label>
              Название
              <input
                name="title"
                value={editor.title}
                onChange={(e) =>
                  setEditor({ ...editor, title: e.target.value })
                }
                required
                maxLength={250}
                placeholder="Например, укладка рельсошпальной решётки"
                disabled={!editable}
              />
            </label>
            <label>
              Раздел КСГ
              <input
                name="section"
                value={editor.section}
                onChange={(e) => setEditor({ ...editor, section: e.target.value })}
                required
                maxLength={200}
                placeholder="Например, земляное полотно"
                disabled={!editable}
              />
            </label>
            <div className="editor-grid">
              <label>
                Код
                <input
                  name="code"
                  value={editor.code}
                  onChange={(e) =>
                    setEditor({ ...editor, code: e.target.value })
                  }
                  required
                  maxLength={40}
                  disabled={!editable}
                />
              </label>
              <label>
                Длительность, дней
                <input
                  name="duration_days"
                  type="number"
                  min={1}
                  max={3650}
                  step={1}
                  value={editor.duration_days}
                  onChange={(e) =>
                    setEditor({ ...editor, duration_days: e.target.value })
                  }
                  required
                  disabled={!editable}
                />
              </label>
            </div>
            <label>
              Начало
              <input
                name="start_date"
                type="date"
                value={editor.start_date}
                onChange={(e) =>
                  setEditor({ ...editor, start_date: e.target.value })
                }
                required
                disabled={!editable}
              />
            </label>
            <div className="end-preview">
              <CalendarDays size={15} />
              <span>Окончание</span>
              <b>
                {editor.start_date && Number(editor.duration_days) > 0
                  ? dateLabel(
                      shift(
                        editor.start_date,
                        Number(editor.duration_days) - 1,
                      ),
                    )
                  : "—"}
              </b>
            </div>
            <div className="editor-grid">
              <label>
                Плановый объём
                <input
                  name="planned"
                  type="number"
                  min="0.001"
                  max="99999999999.999"
                  step="0.001"
                  value={editor.planned}
                  onChange={(e) => setEditor({ ...editor, planned: e.target.value })}
                  required
                  disabled={!editable}
                />
              </label>
              <label>
                Единица
                <select
                  name="unit"
                  value={editor.unit}
                  onChange={(e) => setEditor({ ...editor, unit: e.target.value })}
                  disabled={!editable}
                >
                  {units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
                </select>
              </label>
            </div>
            <label>
              Статус
              <select
                name="status"
                value={editor.status}
                onChange={(e) => {
                  const status = e.target.value;
                  setEditor({
                    ...editor,
                    status,
                    actual_start: status === "planned" ? null : editor.actual_start,
                    actual_end: status === "completed" ? editor.actual_end : null,
                  });
                }}
                disabled={!editable}
              >
                {statusOptions.map((status) => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>
            </label>
            <div className="editor-grid">
              <label>
                Подрядчик
                <select
                  name="contractor_id"
                  value={editor.contractor_id || ""}
                  onChange={(e) => setEditor({ ...editor, contractor_id: e.target.value })}
                  disabled={!editable || plan?.options.contractors.length === 0}
                >
                  <option value="">Основной подрядчик</option>
                  {plan?.options.contractors.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
              <label>
                Ответственный
                <select
                  name="responsible_id"
                  value={editor.responsible_id || ""}
                  onChange={(e) => setEditor({ ...editor, responsible_id: e.target.value })}
                  required
                  disabled={!editable}
                >
                  {plan?.options.responsibles.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="linear-toggle">
              <input
                name="linear"
                type="checkbox"
                checked={!!editor.linear}
                disabled={!editable || plan?.options.axes.length === 0}
                onChange={(e) => {
                  const linear = e.target.checked;
                  const axis = plan?.options.axes.find((item) => item.id === editor.axis_id) || plan?.options.axes[0];
                  setEditor({
                    ...editor,
                    linear,
                    axis_id: linear ? axis?.id || null : null,
                    start_m: linear ? axis?.start_m ?? null : null,
                    end_m: linear ? Math.min((axis?.start_m || 0) + 100, axis?.end_m || 100) : null,
                  });
                }}
              />
              <span>Линейная работа с пикетажем</span>
            </label>
            {editor.linear ? (
              <>
                <label>
                  Ось / путь
                  <select
                    name="axis_id"
                    value={editor.axis_id || ""}
                    onChange={(e) => {
                      const axis = plan?.options.axes.find((item) => item.id === e.target.value);
                      setEditor({
                        ...editor,
                        axis_id: e.target.value || null,
                        start_m: axis?.start_m ?? null,
                        end_m: axis ? Math.min(axis.start_m + 100, axis.end_m) : null,
                      });
                    }}
                    required
                    disabled={!editable}
                  >
                    {plan?.options.axes.map((axis) => (
                      <option key={axis.id} value={axis.id}>{axis.name} · путь {axis.path}</option>
                    ))}
                  </select>
                </label>
                <div className="editor-grid">
                  <label>
                    Начальный пикет, м
                    <input
                      name="start_m"
                      type="number"
                      min={plan?.options.axes.find((axis) => axis.id === editor.axis_id)?.start_m ?? 0}
                      max={plan?.options.axes.find((axis) => axis.id === editor.axis_id)?.end_m}
                      step={1}
                      value={editor.start_m ?? ""}
                      onChange={(e) => setEditor({ ...editor, start_m: e.target.value })}
                      required
                      disabled={!editable}
                    />
                  </label>
                  <label>
                    Конечный пикет, м
                    <input
                      name="end_m"
                      type="number"
                      min={editor.start_m ?? 0}
                      max={plan?.options.axes.find((axis) => axis.id === editor.axis_id)?.end_m}
                      step={1}
                      value={editor.end_m ?? ""}
                      onChange={(e) => setEditor({ ...editor, end_m: e.target.value })}
                      required
                      disabled={!editable}
                    />
                  </label>
                </div>
              </>
            ) : (
              <label>
                Место выполнения
                <input
                  name="location"
                  value={editor.location}
                  onChange={(e) => setEditor({ ...editor, location: e.target.value })}
                  required
                  maxLength={500}
                  placeholder="Площадка, сооружение или участок"
                  disabled={!editable}
                />
              </label>
            )}
            <div className="editor-grid">
              <label>
                Фактическое начало
                <input
                  name="actual_start"
                  type="date"
                  value={editor.actual_start || ""}
                  onChange={(e) => setEditor({ ...editor, actual_start: e.target.value || null })}
                  required={editor.status === "in_progress" || editor.status === "completed"}
                  disabled={!editable}
                />
              </label>
              <label>
                Фактическое окончание
                <input
                  name="actual_end"
                  type="date"
                  value={editor.actual_end || ""}
                  onChange={(e) => setEditor({ ...editor, actual_end: e.target.value || null })}
                  required={editor.status === "completed"}
                  disabled={!editable}
                />
              </label>
            </div>
            {((editor.id && byId.get(editor.id)?.status === "completed" && editor.status !== "completed") ||
              (editor.status === "in_progress" && editor.predecessor_ids.some((id: string) => byId.get(id)?.status !== "completed"))) && (
              <label>
                Причина отклонения от графика
                <textarea
                  name="reason"
                  value={editor.reason || ""}
                  onChange={(e) => setEditor({ ...editor, reason: e.target.value })}
                  maxLength={1000}
                  required
                  disabled={!editable}
                />
              </label>
            )}
            <label>Предшествующие работы</label>
            <div className="predecessor-list">
              {tasks
                .filter((t) => t.id !== editor.id)
                .map((t) => (
                  <label className="predecessor" key={t.id}>
                    <input
                      name="predecessor"
                      type="checkbox"
                      checked={editor.predecessor_ids.includes(t.id)}
                      disabled={!editable}
                      onChange={(e) =>
                        setEditor({
                          ...editor,
                          predecessor_ids: e.target.checked
                            ? [...editor.predecessor_ids, t.id]
                            : editor.predecessor_ids.filter(
                                (p: string) => p !== t.id,
                              ),
                        })
                      }
                    />
                    <b>{t.code}</b>
                    <span>{t.title}</span>
                  </label>
                ))}
              {tasks.filter((t) => t.id !== editor.id).length === 0 && (
                <small>Других работ пока нет</small>
              )}
            </div>
            {editable && (
              <>
                <button
                  className="ksg-primary full"
                  disabled={busy || !recordStatus.ready}
                >
                  <Check size={15} />
                  {busy ? "Сохраняем…" : "Сохранить работу"}
                </button>
                {editor.id && (
                  <button
                    type="button"
                    className="archive-task"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        "task.archive",
                        `/schedule/tasks/${editor.id}/archive`,
                        "POST",
                        { version: editor.version },
                      )
                    }
                  >
                    Убрать из графика
                  </button>
                )}
              </>
            )}
            <p className="editor-help">
              Связь «окончание → начало». Сроки считаются в календарных днях.
              Для завершения нужны фактические даты и принятый плановый объём.
              Все изменения записываются.
            </p>
          </form>
        </aside>
      )}
      {popup && (
        <div
          className="planner-modal-shade"
          onClick={(e) =>
            e.target === e.currentTarget && !busy && setPopup(null)
          }
        >
          <section
            className="planner-modal"
            role="dialog"
            aria-modal="true"
            data-editor="true"
          >
            <div className="editor-heading">
              <h2>
                {popup.kind === "link"
                  ? "Связать работы"
                  : popup.kind === "calculate"
                    ? "Рассчитать график по связям"
                    : "Новый график"}
              </h2>
              <button
                className="ksg-icon"
                aria-label="Закрыть окно"
                onClick={() => setPopup(null)}
                disabled={busy}
              >
                <X size={18} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (popup.kind === "link") {
                  const t = byId.get(popup.to);
                  if (!t) return;
                  if (t.predecessor_ids.includes(popup.from)) {
                    setError("Такая связь уже есть");
                    return;
                  }
                  void mutate(
                    "dependency.edit",
                    `/schedule/tasks/${t.id}`,
                    "PUT",
                    {
                      ...inputTask(t),
                      predecessor_ids: [...t.predecessor_ids, popup.from],
                    },
                    t,
                  );
                } else if (popup.kind === "calculate") {
                  void mutate(
                    "schedule.recalculate",
                    "/schedule/recalculate",
                    "POST",
                    {
                      start_date: popup.start_date,
                      versions: Object.fromEntries(
                        tasks.map((t) => [t.id, t.version]),
                      ),
                    },
                  );
                } else {
                  void mutate(
                    "project.create",
                    "/schedule/new-project",
                    "POST",
                    { name: popup.name, start_date: popup.start_date },
                  ).then((p) => {
                    if (p) {
                      setProjects((old) => [...old, p]);
                      setPid(p.id);
                      setView("gantt");
                    }
                  });
                }
              }}
            >
              {popup.kind === "link" ? (
                <>
                  <label>
                    Предшественник
                    <select
                      name="from"
                      value={popup.from}
                      onChange={(e) =>
                        setPopup({ ...popup, from: e.target.value })
                      }
                    >
                      {tasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.code} · {t.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="link-description">
                    <ArrowRight size={18} /> После окончания этой работы
                    начинается следующая
                  </div>
                  <label>
                    Следующая работа
                    <select
                      name="to"
                      value={popup.to}
                      onChange={(e) =>
                        setPopup({ ...popup, to: e.target.value })
                      }
                    >
                      {tasks.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.code} · {t.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : (
                <>
                  {popup.kind === "project" && (
                    <label>
                      Название графика
                      <input
                        name="project_name"
                        value={popup.name}
                        onChange={(e) =>
                          setPopup({ ...popup, name: e.target.value })
                        }
                        required
                      />
                    </label>
                  )}
                  <label>
                    Начало графика
                    <input
                      name="project_start"
                      type="date"
                      value={popup.start_date}
                      onChange={(e) =>
                        setPopup({ ...popup, start_date: e.target.value })
                      }
                      required
                    />
                  </label>
                  {popup.kind === "calculate" && (
                    <p>
                      Работы будут перенесены на ранние даты с учётом
                      предшественников. Длительности сохранятся. Изменения до и
                      после попадут в запись сессии.
                    </p>
                  )}
                </>
              )}
              {error && <div className="ksg-error">{error}</div>}
              <button
                className="ksg-primary full"
                disabled={busy || !recordStatus.ready}
              >
                {busy
                  ? "Сохраняем…"
                  : popup.kind === "link"
                    ? "Создать связь"
                    : popup.kind === "calculate"
                      ? "Рассчитать сроки"
                      : "Создать график"}
              </button>
            </form>
          </section>
        </div>
      )}
      {detail && (
        <div className="planner-modal-shade">
          <section
            className="planner-modal trace-detail"
            role="dialog"
            aria-modal="true"
            data-editor="true"
          >
            <div className="editor-heading">
              <div>
                <h2>{eventLabel(detail)}</h2>
                <small>
                  {detail.origin === "server"
                    ? "Подтверждено сервером"
                    : "Событие интерфейса"}{" "}
                  · пользователь {detail.user_id || user?.id || "—"}{" "}
                  · {new Date(detail.client_at || detail.received_at).toLocaleString("ru-RU", {
                    dateStyle: "short",
                    timeStyle: "medium",
                  })}{" "}
                  · {detail.id}
                </small>
              </div>
              <button
                className="ksg-icon"
                aria-label="Закрыть событие"
                onClick={() => setDetail(null)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="trace-block">
              <h3>Контекст и действие</h3>
              <pre>
                {JSON.stringify(
                  {
                    observation: detail.observation,
                    action: detail.payload,
                    result: detail.result,
                    action_id: detail.action_id,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
            {detail.before && (
              <div className="snapshot-grid">
                <div>
                  <h3>График до</h3>
                  <pre>{JSON.stringify(detail.before, null, 2)}</pre>
                </div>
                <div>
                  <h3>График после</h3>
                  <pre>{JSON.stringify(detail.after, null, 2)}</pre>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
      {notice && (
        <div className="ksg-toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
    </div>
  );
}
