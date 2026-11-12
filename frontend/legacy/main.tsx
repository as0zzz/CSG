import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileImage,
  FolderKanban,
  History,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MapPin,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  TrainFront,
  TriangleAlert,
  Truck,
  X,
} from "lucide-react";
import { api } from "./api";
import "./style.css";

type Row = Record<string, any>;
const statuses: Record<string, string> = {
  planned: "Запланирована",
  in_progress: "Выполняется",
  suspended: "Приостановлена",
  completed: "Завершена",
  confirmed: "Подтверждено",
  deviation: "Есть отклонение",
  inconclusive: "Недостаточно данных",
  open: "Открыто",
  resolved: "Устранено",
};
const roleNames: Record<string, string> = {
  ProjectAdmin: "Администратор",
  Planner: "Планировщик",
  RemoteInspector: "Инспектор",
  CustomerViewer: "Заказчик",
  ContractorManager: "Подрядчик",
};
const menus = [
  ["overview", "Обзор проекта", LayoutDashboard],
  ["schedule", "Контрольно-сетевой график", CalendarDays],
  ["inspector", "Удалённый инспектор", ShieldCheck],
  ["checks", "Проверки и замечания", ListChecks],
  ["equipment", "Техника и камеры", Truck],
  ["media", "Материалы", FileImage],
  ["audit", "История изменений", History],
  ["settings", "Настройки проекта", Settings2],
] as const;
const pk = (n: number | null) =>
  n == null
    ? "—"
    : `ПК ${Math.floor(n / 100)}+${String(n % 100).padStart(2, "0")}`;
const num = (n: any) =>
  Number(n || 0).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
const date = (s: string) =>
  s
    ? new Date(s.length === 10 ? s + "T12:00:00" : s).toLocaleDateString(
        "ru-RU",
        { day: "2-digit", month: "short" },
      )
    : "—";
const time = (s: string) =>
  s
    ? new Date(s).toLocaleString("ru-RU", {
        timeZone: "Europe/Moscow",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const today = () => new Date().toLocaleDateString("sv-SE");
const stamp = () => new Date().toISOString().slice(0, 16);
const Badge = ({ value }: { value: string }) => (
  <span className={`badge ${value}`}>
    <i />
    {statuses[value] || value}
  </span>
);

function App() {
  const [user, setUser] = useState<Row | null>(null),
    [projects, setProjects] = useState<Row[]>([]),
    [pid, setPid] = useState("");
  const [data, setData] = useState<Row | null>(null),
    [page, setPage] = useState("overview"),
    [modal, setModal] = useState<Row | null>(null);
  const [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  const [login, setLogin] = useState({
    email: "planner@demo.local",
    password: "",
  });
  const [filters, setFilters] = useState({
      q: "",
      status: "",
      axis: "",
      responsible: "",
      contractor: "",
      from: "",
      to: "",
    }),
    [view, setView] = useState("table");
  const [selectedWork, setSelectedWork] = useState(""),
    [selectedMedia, setSelectedMedia] = useState("");
  const [inspectForm, setInspectForm] = useState<Row>({
    outcome: "confirmed",
    proposed: 100,
    comment: "",
    reason: "",
    observed_at: stamp(),
    from_s: 0,
    to_s: "",
    previous_id: "",
  });
  async function load(project = pid) {
    if (project) setData(await api(`/projects/${project}/state`));
  }
  async function bootstrap() {
    try {
      const me = await api("/auth/me");
      setUser(me);
      const list = await api("/projects");
      setProjects(list);
      setPid((p) =>
        list.some((x: Row) => x.id === p) ? p : list[0]?.id || "",
      );
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void bootstrap();
  }, []);
  useEffect(() => {
    if (pid) {
      setLoading(true);
      void load()
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
      setSelectedWork("");
      setSelectedMedia("");
    }
  }, [pid]);
  useEffect(() => {
    if (page !== "equipment" || !pid) return;
    const t = setInterval(
      () => void load().catch((e) => setError(e.message)),
      3500,
    );
    return () => clearInterval(t);
  }, [page, pid]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]'))
      .filter(element => !element.hasAttribute('disabled') && element.getClientRects().length > 0);
    controls()[0]?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) setModal(null);
      if (event.key === 'Tab') {
        const items = controls(), first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keyboard);
    return () => { document.removeEventListener('keydown', keyboard); if (previous?.isConnected) previous.focus(); };
  }, [modal?.kind]);
  async function run(
    fn: () => Promise<unknown>,
    message = "Сохранено",
    close = true,
  ) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      if (close) setModal(null);
      setToast(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const roles: string[] = data?.roles || [],
    can = (role: string) => roles.includes(role);
  const works: Row[] = data?.works?.filter((w: Row) => !w.archived) || [];
  const find = (table: string, id: string) =>
    data?.[table]?.find((r: Row) => r.id === id);
  const label = (table: string, id: string, field = "name") =>
    find(table, id)?.[field] || "—";
  const filtered = works.filter(
    (w) =>
      (!filters.q ||
        `${w.code} ${w.title}`
          .toLowerCase()
          .includes(filters.q.toLowerCase())) &&
      (!filters.status || w.status === filters.status) &&
      (!filters.axis || w.axis_id === filters.axis) &&
      (!filters.responsible || w.responsible_id === filters.responsible) &&
      (!filters.contractor || w.contractor_id === filters.contractor) &&
      (!filters.from || (w.end_m != null && w.end_m >= Number(filters.from))) &&
      (!filters.to || (w.start_m != null && w.start_m <= Number(filters.to))),
  );
  function fieldFilter(key: keyof typeof filters, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
  }
  function goto(p: string) {
    setPage(p);
    setError("");
  }
  const content = (id: string) => `/api/media/${id}/content`;
  function mediaView(m: Row, large = false) {
    return m.content_type.startsWith("video/") ? (
      <video
        controls
        playsInline
        preload="metadata"
        className={large ? "large-media" : ""}
        src={content(m.id)}
        onError={() =>
          setError(
            "Не удалось воспроизвести видео: проверьте доступ и поддержку кодека браузером",
          )
        }
      />
    ) : (
      <img
        className={large ? "large-media" : ""}
        src={content(m.id)}
        alt={m.name}
      />
    );
  }
  function newWork(existing?: Row) {
    setModal({
      kind: "work",
      form: existing
        ? { ...existing, reason: "" }
        : {
            code: `КСГ-${String(works.length + 1).padStart(3, "0")}`,
            title: "",
            section: "Основные работы",
            contractor_id: data?.contractors[0]?.id || "",
            responsible_id: data?.users[0]?.id || "",
            linear: true,
            axis_id: data?.axes[0]?.id || "",
            start_m: data?.axes[0]?.start_m ?? null,
            end_m: data?.axes[0]?.end_m ?? null,
            location: "",
            start_date: today(),
            end_date: today(),
            actual_start: null,
            actual_end: null,
            unit: "м",
            planned: 1000,
            status: "planned",
            version: 1,
            archived: false,
            reason: "",
          },
    });
  }
  function mf(key: string, value: unknown) {
    setModal((m) => (m ? { ...m, form: { ...m.form, [key]: value } } : m));
  }
  function input(
    labelText: string,
    key: string,
    type = "text",
    required = true,
  ) {
    return (
      <label>
        {labelText}
        <input
          type={type}
          required={required}
          value={modal?.form?.[key] ?? ""}
          onChange={(e) =>
            mf(
              key,
              type === "number"
                ? e.target.value === ""
                  ? null
                  : Number(e.target.value)
                : type === "date"
                  ? e.target.value || null
                  : e.target.value,
            )
          }
          step={type === "number" ? (key.endsWith("_m") ? "1" : "0.001") : undefined}
        />
      </label>
    );
  }
  function selectField(
    labelText: string,
    key: string,
    rows: Row[],
    title = "name",
  ) {
    return (
      <label>
        {labelText}
        <select
          required
          value={modal?.form?.[key] ?? ""}
          onChange={(e) => mf(key, e.target.value)}
        >
          <option value="" disabled>
            Выберите
          </option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r[title]}
            </option>
          ))}
        </select>
      </label>
    );
  }
  function workTable(rows: Row[], compact = false) {
    return (
      <div className="table-scroll">
        <table className="work-table">
          <thead>
            <tr>
              <th>Работа / участок</th>
              <th>Статус</th>
              <th>Плановые сроки</th>
              <th>План / принято</th>
              {!compact && <th>Ответственный</th>}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((w) => (
              <tr
                key={w.id}
                onClick={() => setModal({ kind: "detail", id: w.id })}
                tabIndex={0}
                onKeyDown={(e) =>
                  e.key === "Enter" && setModal({ kind: "detail", id: w.id })
                }
              >
                <td>
                  <span className="code">{w.code}</span>
                  <strong>{w.title}</strong>
                  <small>
                    {w.linear
                      ? `${pk(w.start_m)} — ${pk(w.end_m)} · путь ${find("axes", w.axis_id)?.path}`
                      : w.location}
                  </small>
                </td>
                <td>
                  <Badge value={w.status} />
                </td>
                <td className="nowrap">
                  {date(w.start_date)} — {date(w.end_date)}
                  {w.end_date < today() && w.status !== "completed" && (
                    <small className="danger-text">Срок превышен</small>
                  )}
                </td>
                <td>
                  <div className="volume">
                    {num(w.actual)}{" "}
                    <span>
                      / {num(w.planned)} {w.unit}
                    </span>
                  </div>
                  <div className="progress">
                    <i
                      style={{
                        width: `${(Number(w.actual) / Number(w.planned)) * 100}%`,
                      }}
                    />
                  </div>
                </td>
                {!compact && <td>{label("users", w.responsible_id)}</td>}
                <td>
                  <ChevronRight size={16} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <div className="empty">Работ по выбранным условиям нет</div>
        )}
      </div>
    );
  }
  function filtersBar() {
    return (
      <div className="filters">
        <div className="search">
          <Search size={16} />
          <input
            aria-label="Поиск работы"
            placeholder="Поиск по названию или коду"
            value={filters.q}
            onChange={(e) => fieldFilter("q", e.target.value)}
          />
        </div>
        <select
          aria-label="Статус"
          value={filters.status}
          onChange={(e) => fieldFilter("status", e.target.value)}
        >
          <option value="">Все статусы</option>
          {["planned", "in_progress", "suspended", "completed"].map((s) => (
            <option value={s} key={s}>
              {statuses[s]}
            </option>
          ))}
        </select>
        <select
          aria-label="Ось и путь"
          value={filters.axis}
          onChange={(e) => fieldFilter("axis", e.target.value)}
        >
          <option value="">Все пути</option>
          {data?.axes.map((a: Row) => (
            <option key={a.id} value={a.id}>
              {a.name} · путь {a.path}
            </option>
          ))}
        </select>
        <select
          aria-label="Ответственный"
          value={filters.responsible}
          onChange={(e) => fieldFilter("responsible", e.target.value)}
        >
          <option value="">Все ответственные</option>
          {data?.users.map((u: Row) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Подрядчик"
          value={filters.contractor}
          onChange={(e) => fieldFilter("contractor", e.target.value)}
        >
          <option value="">Все подрядчики</option>
          {data?.contractors.map((c: Row) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input
          className="short-input"
          type="number"
          placeholder="От, м"
          aria-label="Начало фильтра в метрах"
          value={filters.from}
          onChange={(e) => fieldFilter("from", e.target.value)}
        />
        <input
          className="short-input"
          type="number"
          placeholder="До, м"
          aria-label="Конец фильтра в метрах"
          value={filters.to}
          onChange={(e) => fieldFilter("to", e.target.value)}
        />
        <button
          className="text-button"
          onClick={() =>
            setFilters({
              q: "",
              status: "",
              axis: "",
              responsible: "",
              contractor: "",
              from: "",
              to: "",
            })
          }
        >
          Сбросить
        </button>
      </div>
    );
  }
  function inspectionCards(items: Row[]) {
    return items.map((i) => (
      <div className="inspection-card" key={i.id}>
        <div className="spread">
          <span className="code">
            {label("works", i.work_id, "code")} · {time(i.observed_at)}
          </span>
          <Badge value={i.outcome} />
        </div>
        <h4>{label("works", i.work_id, "title")}</h4>
        <p>{i.comment || "Без комментария"}</p>
        <small>
          {pk(i.start_m)} — {pk(i.end_m)} · {label("users", i.author_id)}
        </small>
        {i.reason && (
          <p className="warning-text">
            {i.reason === "needs_on_site_check"
              ? "Нужна выездная проверка"
              : "Нужно уточнение"}
          </p>
        )}
        {i.review_required && (
          <p className="warning-text">
            Есть уточнение. Планировщику нужно пересмотреть принятый факт.
          </p>
        )}
        <div className="inline materials-links">
          {i.materials.map((m: Row) => (
            <button
              key={m.id}
              className="link"
              onClick={() => setModal({ kind: "media", id: m.id })}
            >
              <FileImage size={14} /> {label("media", m.id)}
              {m.from_s != null ? ` · ${m.from_s} с` : ""}
            </button>
          ))}
        </div>
        <div className="spread card-bottom">
          <span>
            {i.outcome === "confirmed"
              ? `${num(i.proposed)} ${label("works", i.work_id, "unit")} · ${i.applied ? "Объём принят" : "Ожидает решения планировщика"}`
              : "КСГ не изменён"}
          </span>
          <div className="inline">
            {can("RemoteInspector") && (
              <button
                className="text-button"
                onClick={() => {
                  setSelectedWork(i.work_id);
                  setInspectForm({
                    ...inspectForm,
                    previous_id: i.id,
                    outcome: i.outcome,
                    comment: "",
                    proposed: i.proposed,
                  });
                  setModal(null);
                  goto("inspector");
                }}
              >
                Уточнить
              </button>
            )}
            {can("Planner") && i.outcome === "confirmed" && !i.applied && (
              <button
                className="small primary"
                onClick={() =>
                  setModal({
                    kind: "apply",
                    id: i.id,
                    form: { reason: "Принятие объёма по результату проверки" },
                  })
                }
              >
                Принять объём
              </button>
            )}
          </div>
        </div>
      </div>
    ));
  }

  if (loading && !user)
    return <div className="boot">Загрузка центра управления…</div>;
  if (!user)
    return (
      <div className="login-page">
        <div className="login-story">
          <div className="brand">
            <TrainFront size={32} />
            <div>
              АКСГ<small>ЦЕНТР УПРАВЛЕНИЯ</small>
            </div>
          </div>
          <div>
            <span className="eyebrow">СТРОИТЕЛЬСТВО ПОД КОНТРОЛЕМ</span>
            <h1>
              Один график.
              <br />
              Полная картина
              <br />
              строительства.
            </h1>
            <p>
              Работы, участки, материалы проверок
              <br />и решения команды — в одном месте.
            </p>
            <div className="rail-art">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
          </div>
          <span className="login-foot">
            Железнодорожная инфраструктура / Демонстрационный прототип
          </span>
        </div>
        <div className="login-form">
          <span className="demo-tag">ДЕМОНСТРАЦИОННЫЙ КОНТУР</span>
          <h2>Вход в рабочее пространство</h2>
          <p className="muted">
            Выберите профиль и введите пароль из локального файла .env.
          </p>
          <div className="profile-grid">
            {[
              ["planner", "Планировщик"],
              ["inspector", "Инспектор"],
              ["customer", "Заказчик"],
              ["admin", "Администратор"],
              ["contractor", "Подрядчик"],
            ].map(([key, name]) => (
              <button
                className={login.email.startsWith(key + "@") ? "active" : ""}
                key={key}
                onClick={() =>
                  setLogin({ ...login, email: `${key}@demo.local` })
                }
              >
                {name}
              </button>
            ))}
          </div>
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
              Электронная почта
              <input
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
              <div className="error" role="alert">
                {error}
              </div>
            )}
            <button className="primary full" disabled={busy}>
              Войти в систему <ArrowRight size={18} />
            </button>
          </form>
          <p className="login-note">
            <ShieldCheck size={18} /> Доступ к данным определяется ролью и
            проектом
          </p>
        </div>
      </div>
    );
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <TrainFront size={30} />
          <div>
            АКСГ<small>ЦЕНТР УПРАВЛЕНИЯ</small>
          </div>
        </div>
        <div className="workspace-label">РАБОЧЕЕ ПРОСТРАНСТВО</div>
        <nav>
          {menus.map(([key, title, Icon]) => (
            <button
              key={key}
              className={page === key ? "selected" : ""}
              onClick={() => goto(key)}
            >
              <Icon size={18} />
              <span>{title}</span>
              {page === key && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="system-state">
            <i /> Локальная система
          </div>
          <p>
            Демонстрационный прототип
            <br />
            Все данные вымышленные
          </p>
          <div className="version">АКСГ / версия 1.0</div>
        </div>
      </aside>
      <div className="workspace">
        <header>
          <div className="crumb">
            Проекты <ChevronRight size={14} />
            <strong>{data?.project?.code || "Выбор проекта"}</strong>
            <span className="demo-tag">ДЕМО</span>
          </div>
          <div className="user">
            <span className="avatar">{user.name.slice(0, 1)}</span>
            <div>
              <b>{user.name}</b>
              <small>{roles.map((r) => roleNames[r]).join(", ")}</small>
            </div>
            <button
              title="Выйти"
              aria-label="Выйти"
              className="icon-button"
              onClick={() =>
                void api("/auth/logout", "POST").then(() => {
                  setUser(null);
                  setData(null);
                  setPid("");
                  setLogin({ ...login, password: "" });
                })
              }
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>
        <main>
          <div className="project-bar">
            <div>
              <FolderKanban size={16} />
              <select
                aria-label="Проект"
                value={pid}
                onChange={(e) => {
                  setData(null);
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
            <span>
              <CalendarDays size={15} />{" "}
              {new Date().toLocaleDateString("ru-RU", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </span>
          </div>
          {error && (
            <div role="alert" className="error spread">
              {error}
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Закрыть ошибку"
              >
                <X size={16} />
              </button>
            </div>
          )}
          {!projects.length ? (
            <div className="empty panel">У вас пока нет доступных проектов</div>
          ) : loading || !data ? (
            <div className="empty">Загрузка данных проекта…</div>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {page === "overview"
                      ? "ЦЕНТР УПРАВЛЕНИЯ СТРОИТЕЛЬСТВОМ"
                      : "РАБОЧЕЕ ПРОСТРАНСТВО ПРОЕКТА"}
                  </div>
                  <h1>{menus.find((m) => m[0] === page)?.[1]}</h1>
                  <p>
                    {page === "overview"
                      ? "Актуальное состояние работ, проверок и замечаний по проекту."
                      : page === "schedule"
                        ? "Плановые сроки, подтверждённые объёмы и связи между работами."
                        : page === "inspector"
                          ? "Оцените материалы и зафиксируйте заключение по выбранной работе."
                          : "Все записи связаны с текущим проектом."}
                  </p>
                </div>
                {page === "overview" ? (
                  <button className="primary" onClick={() => goto("schedule")}>
                    Открыть КСГ <ArrowRight size={16} />
                  </button>
                ) : page === "schedule" && can("Planner") ? (
                  <button className="primary" onClick={() => newWork()}>
                    <Plus size={16} /> Добавить работу
                  </button>
                ) : null}
              </div>
              {page === "overview" && (
                <>
                  <div className="metrics">
                    {[
                      [
                        data.summary.total,
                        "Работ в графике",
                        "Все этапы проекта",
                        CalendarDays,
                        "neutral",
                      ],
                      [
                        data.summary.statuses.in_progress,
                        "Выполняются",
                        "Активные работы",
                        Activity,
                        "green",
                      ],
                      [
                        data.summary.statuses.completed,
                        "Завершены",
                        "Объём принят планировщиком",
                        CheckCircle2,
                        "green",
                      ],
                      [
                        data.summary.open_remarks,
                        "Открытых замечаний",
                        `${data.summary.overdue} работ с превышением срока`,
                        TriangleAlert,
                        "amber",
                      ],
                    ].map(([value, title, caption, Icon, color]: any) => (
                      <div className="metric panel" key={title}>
                        <div className="spread">
                          <span>{title}</span>
                          <span className={`metric-icon ${color}`}>
                            <Icon size={19} />
                          </span>
                        </div>
                        <strong>
                          {value}
                          <small> / {data.summary.total}</small>
                        </strong>
                        <p>{caption}</p>
                      </div>
                    ))}
                  </div>
                  <div className="overview-grid">
                    <section className="panel">
                      <div className="panel-title">
                        <div>
                          <h3>Работы в фокусе</h3>
                          <p>Текущие этапы и ближайшие решения</p>
                        </div>
                        <button
                          className="link"
                          onClick={() => goto("schedule")}
                        >
                          Весь график <ArrowRight size={14} />
                        </button>
                      </div>
                      {workTable(
                        works.filter((w) => w.status !== "planned").slice(0, 5),
                        true,
                      )}
                      <div className="panel-footer">
                        <span>
                          <span className="dot green" /> Ручное подтверждение
                          факта
                        </span>
                        <span>{works.length} работ в проекте</span>
                      </div>
                    </section>
                    <section className="panel">
                      <div className="panel-title">
                        <div>
                          <h3>Последние проверки</h3>
                          <p>Решения удалённого инспектора</p>
                        </div>
                        <ShieldCheck size={20} />
                      </div>
                      <div className="recent-checks">
                        {data.inspections.slice(0, 4).map((i: Row) => (
                          <button
                            key={i.id}
                            onClick={() => {
                              setSelectedWork(i.work_id);
                              goto("checks");
                            }}
                          >
                            <span className={`check-icon ${i.outcome}`}>
                              <Check size={17} />
                            </span>
                            <div>
                              <strong>
                                {label("works", i.work_id, "title")}
                              </strong>
                              <span>{statuses[i.outcome]}</span>
                              <small>
                                {time(i.observed_at)} · {pk(i.start_m)}
                              </small>
                            </div>
                            <ChevronRight size={14} />
                          </button>
                        ))}
                      </div>
                      <button
                        className="panel-link"
                        onClick={() => goto("checks")}
                      >
                        Все проверки <ArrowRight size={14} />
                      </button>
                    </section>
                  </div>
                  <div className="bottom-grid">
                    <section className="panel">
                      <div className="panel-title">
                        <h3>Ход работ по статусам</h3>
                        <span className="muted">Количество работ</span>
                      </div>
                      <div className="status-chart">
                        {Object.entries(data.summary.statuses).map(([s, n]) => (
                          <div key={s}>
                            <div className="spread">
                              <span>
                                <span className={`dot ${s}`} />
                                {statuses[s]}
                              </span>
                              <b>{Number(n)}</b>
                            </div>
                            <div className={`chart-bar ${s}`}>
                              <i
                                style={{
                                  width: `${(Number(n) / Math.max(data.summary.total, 1)) * 100}%`,
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                    <section className="panel">
                      <div className="panel-title">
                        <h3>Последние изменения</h3>
                        <button className="link" onClick={() => goto("audit")}>
                          Журнал <ArrowRight size={14} />
                        </button>
                      </div>
                      <div className="activity-list">
                        {data.audit.slice(0, 3).map((a: Row) => (
                          <div key={a.id}>
                            <span className="activity-dot" />
                            <div>
                              <strong>{a.action}</strong>
                              <small>
                                {label("users", a.author_id)} ·{" "}
                                {time(a.created_at)}
                              </small>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                  <div className="demo-note">
                    <ShieldCheck size={16} />
                    <span>
                      Решения принимает человек. Материалы и координаты не
                      изменяют график автоматически.
                    </span>
                    <span className="right">Демонстрационные данные</span>
                  </div>
                </>
              )}
              {page === "schedule" && (
                <section className="panel">
                  <div className="panel-title">
                    <div className="tabs">
                      <button
                        className={view === "table" ? "active" : ""}
                        onClick={() => setView("table")}
                      >
                        Таблица работ
                      </button>
                      <button
                        className={view === "timeline" ? "active" : ""}
                        onClick={() => setView("timeline")}
                      >
                        Временная диаграмма
                      </button>
                    </div>
                    <span className="muted">
                      Найдено: {filtered.length}
                      {data.total_works > 300 ? " · первые 300 записей" : ""}
                    </span>
                  </div>
                  {filtersBar()}
                  {view === "table" ? (
                    workTable(filtered)
                  ) : (
                    <div className="timeline">
                      {filtered.map((w) => {
                        const start = new Date(
                            data.project.start_date,
                          ).getTime(),
                          end = new Date(data.project.end_date).getTime(),
                          total = end - start || 1;
                        return (
                          <button
                            className="timeline-row"
                            key={w.id}
                            onClick={() =>
                              setModal({ kind: "detail", id: w.id })
                            }
                          >
                            <div>
                              <span className="code">{w.code}</span>
                              <strong>{w.title}</strong>
                            </div>
                            <div className="timeline-track">
                              <i
                                className={w.status}
                                style={{
                                  left: `${Math.max(0, ((new Date(w.start_date).getTime() - start) / total) * 100)}%`,
                                  width: `${Math.max(2, Math.min(100, ((new Date(w.end_date).getTime() - new Date(w.start_date).getTime()) / total) * 100))}%`,
                                }}
                              >
                                {date(w.start_date)} — {date(w.end_date)}
                              </i>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}
              {page === "inspector" && (
                <div className="inspector-layout">
                  <section className="panel">
                    <div className="panel-title">
                      <h3>Материалы наблюдения</h3>
                      <span className="demo-tag">ЗАГРУЖЕННЫЕ МАТЕРИАЛЫ</span>
                    </div>
                    <div className="padded">
                      <label>
                        Работа
                        <select
                          value={selectedWork}
                          onChange={(e) => {
                            setSelectedWork(e.target.value);
                            setInspectForm({ ...inspectForm, previous_id: "", start_m: undefined, end_m: undefined });
                          }}
                        >
                          <option value="">Выберите работу</option>
                          {works.map((w) => (
                            <option value={w.id} key={w.id}>
                              {w.code} · {w.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Фото или видео
                        <select
                          value={selectedMedia}
                          onChange={(e) => setSelectedMedia(e.target.value)}
                        >
                          <option value="">Выберите материал</option>
                          {data.media
                            .filter((m: Row) => !m.archived)
                            .map((m: Row) => (
                              <option value={m.id} key={m.id}>
                                {m.name} ·{" "}
                                {m.duration ? `${m.duration} с` : "фото"}
                              </option>
                            ))}
                        </select>
                      </label>
                      <div className="media-stage">
                        {selectedMedia ? (
                          mediaView(find("media", selectedMedia), true)
                        ) : (
                          <div className="empty">
                            <Camera size={40} />
                            <p>Выберите загруженное фото или видео</p>
                            <small>
                              Подключение живых камер вне демонстрационного
                              прототипа
                            </small>
                          </div>
                        )}
                      </div>
                      {selectedMedia && (
                        <small className="muted">
                          Источник:{" "}
                          {find("media", selectedMedia)?.source === "synthetic"
                            ? "синтетические данные"
                            : "пользовательская загрузка"}{" "}
                          · съёмка:{" "}
                          {time(find("media", selectedMedia)?.captured_at)}
                        </small>
                      )}
                    </div>
                  </section>
                  <section className="panel">
                    <div className="panel-title">
                      <h3>Заключение инспектора</h3>
                      <ShieldCheck size={19} />
                    </div>
                    {can("RemoteInspector") ? (
                      <form
                        className="padded"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const w = find("works", selectedWork);
                          if (!w) {
                            setError("Выберите работу");
                            return;
                          }
                          void run(
                            () =>
                              api(`/projects/${pid}/inspections`, "POST", {
                                work_id: w.id,
                                start_m: inspectForm.start_m ?? w.start_m,
                                end_m: inspectForm.end_m ?? w.end_m,
                                outcome: inspectForm.outcome,
                                reason:
                                  inspectForm.outcome === "inconclusive"
                                    ? inspectForm.reason
                                    : "",
                                comment: inspectForm.comment,
                                proposed:
                                  inspectForm.outcome === "confirmed"
                                    ? Number(inspectForm.proposed)
                                    : 0,
                                observed_at: inspectForm.observed_at + "Z",
                                previous_id: inspectForm.previous_id || null,
                                materials: selectedMedia
                                  ? [
                                      {
                                        id: selectedMedia,
                                        from_s: find("media", selectedMedia)
                                          ?.duration
                                          ? Number(inspectForm.from_s)
                                          : null,
                                        to_s:
                                          inspectForm.to_s === ""
                                            ? null
                                            : Number(inspectForm.to_s),
                                      },
                                    ]
                                  : [],
                              }),
                            "Проверка сохранена. КСГ не изменён",
                            false,
                          );
                        }}
                      >
                        {inspectForm.previous_id && (
                          <p className="notice">
                            Уточнение предыдущей проверки. Исходная запись будет
                            сохранена.
                          </p>
                        )}
                        <label>
                          Результат
                          <select
                            value={inspectForm.outcome}
                            onChange={(e) =>
                              setInspectForm({
                                ...inspectForm,
                                outcome: e.target.value,
                              })
                            }
                          >
                            {["confirmed", "deviation", "inconclusive"].map(
                              (s) => (
                                <option key={s} value={s}>
                                  {statuses[s]}
                                </option>
                              ),
                            )}
                          </select>
                        </label>
                        {inspectForm.outcome === "confirmed" && (
                          <label>
                            Дополнительный подтверждённый объём
                            <input
                              type="number"
                              min="0.001"
                              step="0.001"
                              value={inspectForm.proposed}
                              onChange={(e) =>
                                setInspectForm({
                                  ...inspectForm,
                                  proposed: e.target.value,
                                })
                              }
                            />
                          </label>
                        )}
                        {inspectForm.outcome === "inconclusive" && (
                          <label>
                            Что требуется
                            <select
                              required
                              value={inspectForm.reason}
                              onChange={(e) =>
                                setInspectForm({
                                  ...inspectForm,
                                  reason: e.target.value,
                                })
                              }
                            >
                              <option value="">Выберите причину</option>
                              <option value="needs_on_site_check">
                                Выездная проверка
                              </option>
                              <option value="needs_clarification">
                                Уточнение
                              </option>
                            </select>
                          </label>
                        )}
                        <div className="form-grid">
                          <label>
                            Начало участка, м
                            <input
                              type="number"
                              step="1"
                              value={
                                inspectForm.start_m ??
                                find("works", selectedWork)?.start_m ??
                                ""
                              }
                              onChange={(e) =>
                                setInspectForm({
                                  ...inspectForm,
                                  start_m: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                          <label>
                            Конец участка, м
                            <input
                              type="number"
                              step="1"
                              value={
                                inspectForm.end_m ??
                                find("works", selectedWork)?.end_m ??
                                ""
                              }
                              onChange={(e) =>
                                setInspectForm({
                                  ...inspectForm,
                                  end_m: Number(e.target.value),
                                })
                              }
                            />
                          </label>
                        </div>
                        <label>
                          Время наблюдения (UTC)
                          <input
                            type="datetime-local"
                            required
                            value={inspectForm.observed_at}
                            onChange={(e) =>
                              setInspectForm({
                                ...inspectForm,
                                observed_at: e.target.value,
                              })
                            }
                          />
                        </label>
                        {find("media", selectedMedia)?.duration && (
                          <div className="form-grid">
                            <label>
                              Видео от, с
                              <input
                                type="number"
                                min="0"
                                max={find("media", selectedMedia)?.duration}
                                step="0.1"
                                value={inspectForm.from_s}
                                onChange={(e) =>
                                  setInspectForm({
                                    ...inspectForm,
                                    from_s: e.target.value,
                                  })
                                }
                              />
                            </label>
                            <label>
                              До, с (необязательно)
                              <input
                                type="number"
                                min="0"
                                step="0.1"
                                value={inspectForm.to_s}
                                onChange={(e) =>
                                  setInspectForm({
                                    ...inspectForm,
                                    to_s: e.target.value,
                                  })
                                }
                              />
                            </label>
                          </div>
                        )}
                        <label>
                          Комментарий
                          <textarea
                            value={inspectForm.comment}
                            onChange={(e) =>
                              setInspectForm({
                                ...inspectForm,
                                comment: e.target.value,
                              })
                            }
                            placeholder="Что удалось проверить и на каком основании"
                          />
                        </label>
                        <button className="primary full" disabled={busy}>
                          <Check size={16} /> Сохранить проверку
                        </button>
                        <p className="form-help">
                          Принятие объёма и изменение графика выполняет
                          планировщик.
                        </p>
                      </form>
                    ) : (
                      <div className="empty">
                        Создание проверок доступно инспектору. Вы можете
                        просматривать материалы.
                      </div>
                    )}
                  </section>
                </div>
              )}
              {page === "checks" && (
                <>
                  <div className="spread section-controls">
                    <div className="inline">
                      <select
                        aria-label="Фильтр проверок по работе"
                        value={selectedWork}
                        onChange={(e) => setSelectedWork(e.target.value)}
                      >
                        <option value="">Все работы</option>
                        {works.map((w) => (
                          <option value={w.id} key={w.id}>
                            {w.code} · {w.title}
                          </option>
                        ))}
                      </select>
                      <span className="muted">
                        {data.inspections.length} проверок
                      </span>
                    </div>
                    {can("RemoteInspector") && (
                      <button
                        className="primary"
                        onClick={() =>
                          setModal({
                            kind: "remark",
                            form: {
                              work_id: selectedWork || works[0]?.id,
                              responsible_id: data.users[0]?.id,
                              title: "",
                              due_date: today(),
                            },
                          })
                        }
                      >
                        <Plus size={16} /> Замечание
                      </button>
                    )}
                  </div>
                  <div className="checks-layout">
                    <section>
                      <h3 className="section-title">Записи проверок</h3>
                      {inspectionCards(
                        data!.inspections.filter(
                          (i: Row) =>
                            !selectedWork || i.work_id === selectedWork,
                        ),
                      )}
                    </section>
                    <section>
                      <h3 className="section-title">Замечания</h3>
                      {data.remarks
                        .filter(
                          (r: Row) =>
                            !selectedWork || r.work_id === selectedWork,
                        )
                        .map((r: Row) => (
                          <div className="panel remark-card" key={r.id}>
                            <div className="spread">
                              <span className="code">
                                {label("works", r.work_id, "code")}
                              </span>
                              <Badge value={r.status} />
                            </div>
                            <h4>{r.title}</h4>
                            <small>
                              Срок: {date(r.due_date)} ·{" "}
                              {label("users", r.responsible_id)}
                            </small>
                            {r.replies.map((reply: Row, index: number) => (
                              <div className="reply" key={index}>
                                <b>{label("users", reply.author_id)}</b>
                                <p>{reply.text}</p>
                                <small>{time(reply.at)}</small>
                              </div>
                            ))}
                            {(can("RemoteInspector") ||
                              can("ContractorManager")) && (
                              <button
                                className="text-button"
                                onClick={() =>
                                  setModal({
                                    kind: "reply",
                                    id: r.id,
                                    form: {
                                      text: "",
                                      status: can("RemoteInspector")
                                        ? "resolved"
                                        : "in_progress",
                                    },
                                  })
                                }
                              >
                                Добавить ответ / изменить состояние{" "}
                                <ArrowRight size={13} />
                              </button>
                            )}
                          </div>
                        ))}
                    </section>
                  </div>
                </>
              )}
              {page === "equipment" && (
                <>
                  <div className="notice inline">
                    <MapPin size={18} /> Координаты моделируются. Пикетаж взят
                    из демонстрационного маршрута.
                  </div>
                  {can("ProjectAdmin") && (
                    <div className="section-controls inline">
                      <button
                        className="primary"
                        onClick={() =>
                          setModal({
                            kind: "equipment",
                            form: {
                              name: "",
                              inventory: "",
                              contractor_id: data.contractors[0]?.id,
                              axis_id: data.axes[0]?.id,
                            },
                          })
                        }
                      >
                        <Plus size={16} /> Добавить технику
                      </button>
                      <button
                        onClick={() =>
                          setModal({
                            kind: "camera",
                            form: {
                              name: "",
                              equipment_id: data.equipment[0]?.id,
                              available: true,
                            },
                          })
                        }
                      >
                        <Plus size={16} /> Добавить камеру
                      </button>
                    </div>
                  )}
                  <div className="equipment-grid">
                    {data.equipment.map((e: Row) => (
                      <section className="panel equipment-card" key={e.id}>
                        <div className="spread">
                          <span className="equipment-icon">
                            <Truck size={24} />
                          </span>
                          <span
                            className={`signal ${e.sim_state === "running" ? "online" : ""}`}
                          >
                            <i />
                            {e.sim_state === "running"
                              ? "Идёт передача"
                              : e.sim_state === "no_signal"
                                ? "Нет сигнала"
                                : "Остановлен"}
                          </span>
                        </div>
                        <h3>{e.name}</h3>
                        <small>
                          {e.inventory} ·{" "}
                          {label("contractors", e.contractor_id)}
                        </small>
                        <div className="linear-track">
                          <span>ПК 100</span>
                          <div>
                            <i
                              style={{
                                left: `${e.point ? ((e.point.offset_m - 10000) / 4000) * 100 : 0}%`,
                              }}
                            >
                              <Truck size={18} />
                            </i>
                          </div>
                          <span>ПК 140</span>
                        </div>
                        <div className="spread">
                          <b>{e.point ? pk(e.point.offset_m) : "Нет точек"}</b>
                          <span className="muted">
                            Путь {find("axes", e.axis_id)?.path}
                          </span>
                        </div>
                        <p className="muted">
                          Последняя точка: {time(e.point?.observed_at)}
                          <br />
                          Источник: simulated
                        </p>
                        {can("ProjectAdmin") && (
                          <div className="sim-buttons">
                            {[
                              ["start", "Запустить"],
                              ["stop", "Стоп"],
                              ["signal_loss", "Нет сигнала"],
                              ["reset", "Сброс"],
                            ].map(([cmd, title]) => (
                              <button
                                disabled={busy}
                                key={cmd}
                                onClick={() =>
                                  void run(
                                    () =>
                                      api(
                                        `/projects/${pid}/equipment/${e.id}/simulate/${cmd}`,
                                        "POST",
                                      ),
                                    "Состояние симулятора изменено",
                                    false,
                                  )
                                }
                              >
                                {title}
                              </button>
                            ))}
                          </div>
                        )}
                      </section>
                    ))}
                  </div>
                  <h3 className="section-title">
                    Камеры · загруженные материалы
                  </h3>
                  <div className="equipment-grid">
                    {data.cameras.map((c: Row) => (
                      <section className="panel equipment-card" key={c.id}>
                        <Camera size={24} />
                        <h3>{c.name}</h3>
                        <p className="muted">
                          {label("equipment", c.equipment_id)} ·{" "}
                          {c.available
                            ? "Доступна для материалов"
                            : "Недоступна"}
                        </p>
                        <p>Демонстрация — загруженные материалы</p>
                        {data.media
                          .filter(
                            (m: Row) => m.camera_id === c.id && !m.archived,
                          )
                          .map((m: Row) => (
                            <button
                              className="link block"
                              key={m.id}
                              onClick={() =>
                                setModal({ kind: "media", id: m.id })
                              }
                            >
                              {m.name} <ArrowRight size={13} />
                            </button>
                          ))}
                      </section>
                    ))}
                  </div>
                </>
              )}
              {page === "media" && (
                <>
                  <div className="spread section-controls">
                    <p className="muted">
                      Фото до 20 МБ · видео до 200 МБ · доступ по ролям проекта
                    </p>
                    {(can("Planner") ||
                      can("RemoteInspector") ||
                      can("ProjectAdmin")) && (
                      <button
                        className="primary"
                        onClick={() =>
                          setModal({
                            kind: "upload",
                            form: { camera_id: "", contractor_visible: false },
                          })
                        }
                      >
                        <ArrowDownToLine size={17} /> Загрузить материал
                      </button>
                    )}
                  </div>
                  <div className="media-grid">
                    {data.media
                      .filter((m: Row) => !m.archived)
                      .map((m: Row) => (
                        <article className="panel media-card" key={m.id}>
                          <button
                            className="media-thumb"
                            onClick={() =>
                              setModal({ kind: "media", id: m.id })
                            }
                          >
                            {m.content_type.startsWith("video/") ? (
                              <div className="video-thumb">
                                <Camera size={40} />
                                <span>Видеофрагмент · {m.duration} с</span>
                              </div>
                            ) : (
                              <img src={content(m.id)} alt={m.name} />
                            )}
                            <span className="demo-tag">
                              {m.source === "synthetic" ? "ДЕМО" : "ЗАГРУЖЕНО"}
                            </span>
                          </button>
                          <div className="padded">
                            <h4>{m.name}</h4>
                            <small>
                              {(m.size / 1024 / 1024).toFixed(2)} МБ ·{" "}
                              {time(m.created_at)}
                            </small>
                            <div className="spread card-bottom">
                              <span className="muted">
                                {m.contractor_visible
                                  ? "Доступен подрядчику по связанным работам"
                                  : "Только команда проекта"}
                              </span>
                              {(can("Planner") ||
                                can("RemoteInspector") ||
                                can("ProjectAdmin")) && (
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() =>
                                    void run(
                                      () =>
                                        api(
                                          `/projects/${pid}/media/${m.id}/archive`,
                                          "POST",
                                        ),
                                      "Материал архивирован",
                                      false,
                                    )
                                  }
                                >
                                  В архив
                                </button>
                              )}
                            </div>
                          </div>
                        </article>
                      ))}
                  </div>
                </>
              )}
              {page === "audit" && (
                <section className="panel">
                  <div className="panel-title">
                    <h3>Журнал действий</h3>
                    <span className="muted">
                      Только чтение · последние 300 записей
                    </span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Дата и время · МСК</th>
                          <th>Действие</th>
                          <th>Автор</th>
                          <th>Причина</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {data.audit.map((a: Row) => (
                          <tr key={a.id}>
                            <td>{time(a.created_at)}</td>
                            <td>
                              <strong>{a.action}</strong>
                              <small>
                                {label("works", a.entity_id, "code") !== "—"
                                  ? label("works", a.entity_id, "code")
                                  : a.entity_type}
                              </small>
                            </td>
                            <td>{label("users", a.author_id)}</td>
                            <td>{a.reason || "—"}</td>
                            <td>
                              <button
                                className="link"
                                onClick={() =>
                                  setModal({ kind: "audit", id: a.id })
                                }
                              >
                                До / после
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
              {page === "settings" && (
                <section className="panel padded">
                  <div className="spread">
                    <h3>Настройки и участники</h3>
                    {can("ProjectAdmin") && (
                      <div className="inline">
                        <button
                          onClick={() =>
                            setModal({
                              kind: "projectEdit",
                              form: { ...data.project },
                            })
                          }
                        >
                          Изменить проект
                        </button>
                        <button
                          onClick={() =>
                            setModal({
                              kind: "project",
                              form: {
                                code: "",
                                name: "",
                                description: "",
                                start_date: today(),
                                end_date: today(),
                              },
                            })
                          }
                        >
                          <Plus size={15} /> Новый проект
                        </button>
                      </div>
                    )}
                  </div>
                  <p>{data.project.description}</p>
                  <p className="muted">
                    {date(data.project.start_date)} —{" "}
                    {date(data.project.end_date)} · Europe/Moscow
                  </p>
                  <div className="settings-grid">
                    <div>
                      <div className="spread">
                        <h4>Участники проекта</h4>
                        {can("ProjectAdmin") && (
                          <button
                            className="text-button"
                            onClick={() =>
                              setModal({
                                kind: "member",
                                form: {
                                  user_id: "",
                                  email: "",
                                  roles: ["CustomerViewer"],
                                  contractor_id: null,
                                },
                              })
                            }
                          >
                            Добавить участника
                          </button>
                        )}
                      </div>
                      {data.users.map((u: Row) => (
                        <div key={u.id} className="member-row">
                          <span className="avatar">{u.name.slice(0, 1)}</span>
                          <div>
                            <b>{u.name}</b>
                            <small>{u.email}</small>
                            <small>
                              {data.members
                                .find((m: Row) => m.user_id === u.id)
                                ?.roles.map((r: string) => roleNames[r])
                                .join(", ")}
                            </small>
                          </div>
                          {can("ProjectAdmin") && (
                            <button
                              className="text-button"
                              onClick={() =>
                                setModal({
                                  kind: "member",
                                  form: {
                                    user_id: u.id,
                                    roles: data.members.find(
                                      (m: Row) => m.user_id === u.id,
                                    )?.roles || ["CustomerViewer"],
                                    contractor_id:
                                      data.members.find(
                                        (m: Row) => m.user_id === u.id,
                                      )?.contractor_id || null,
                                  },
                                })
                              }
                            >
                              Роли
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div>
                      <h4>Оси и подрядчики</h4>
                      {data.axes.map((a: Row) => (
                        <p key={a.id}>
                          {a.name} · путь {a.path}
                          <small>
                            {pk(a.start_m)} — {pk(a.end_m)}
                          </small>
                        </p>
                      ))}
                      {data.contractors.map((c: Row) => (
                        <p key={c.id}>{c.name}</p>
                      ))}
                      {can("ProjectAdmin") && (
                        <div className="inline">
                          <button
                            onClick={() =>
                              setModal({
                                kind: "axis",
                                form: {
                                  name: "",
                                  path: "1",
                                  start_m: 10000,
                                  end_m: 14000,
                                },
                              })
                            }
                          >
                            Добавить ось
                          </button>
                          <button
                            onClick={() =>
                              setModal({
                                kind: "contractor",
                                form: { name: "" },
                              })
                            }
                          >
                            Подрядчик
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
          <footer>
            <span>АКСГ · Центр управления строительством</span>
            <span>Ручное ведение КСГ / Демонстрационный контур</span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {modal && (
        <div
          className="modal-shade"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setModal(null);
          }}
        >
          <section
            className={`modal ${["detail", "media", "audit"].includes(modal.kind) ? "wide" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label="Карточка и действия"
          >
            <div className="modal-heading">
              <h2>
                {
                  {
                    work: modal.form?.id
                      ? "Редактирование работы"
                      : "Новая работа",
                    detail: "Карточка работы",
                    apply: "Принять подтверждённый объём",
                    progress: "Корректировка принятого объёма",
                    upload: "Загрузка материала",
                    media: "Материал проверки",
                    remark: "Новое замечание",
                    reply: "Ответ на замечание",
                    equipment: "Добавить технику",
                    camera: "Добавить камеру",
                    dependency: "Добавить зависимость",
                    audit: "История изменения",
                    member: "Роли участника",
                    project: "Новый проект",
                    projectEdit: "Настройки проекта",
                    axis: "Новая ось",
                    contractor: "Новый подрядчик",
                  }[
                    modal.kind as keyof {
                      work: string;
                      detail: string;
                      apply: string;
                      progress: string;
                      upload: string;
                      media: string;
                      remark: string;
                      reply: string;
                      equipment: string;
                      camera: string;
                      dependency: string;
                      audit: string;
                      member: string;
                      project: string;
                      projectEdit: string;
                      axis: string;
                      contractor: string;
                    }
                  ]
                }
              </h2>
              <button
                className="icon-button"
                aria-label="Закрыть"
                disabled={busy}
                onClick={() => setModal(null)}
              >
                <X size={20} />
              </button>
            </div>
            {error && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            {modal.kind === "detail" &&
              (() => {
                const w = find("works", modal.id);
                if (!w) return <p>Работа не найдена</p>;
                return (
                  <>
                    <div className="detail-heading">
                      <span className="code">{w.code}</span>
                      <Badge value={w.status} />
                      <h2>{w.title}</h2>
                      <p>
                        {pk(w.start_m)} — {pk(w.end_m)} · путь{" "}
                        {find("axes", w.axis_id)?.path}
                      </p>
                    </div>
                    <div className="detail-grid">
                      <div>
                        <small>Плановые сроки</small>
                        <b>
                          {date(w.start_date)} — {date(w.end_date)}
                        </b>
                      </div>
                      <div>
                        <small>Фактические сроки</small>
                        <b>
                          {date(w.actual_start)} — {date(w.actual_end)}
                        </b>
                      </div>
                      <div>
                        <small>План / принятый объём</small>
                        <b>
                          {num(w.planned)} / {num(w.actual)} {w.unit}
                        </b>
                      </div>
                      <div>
                        <small>Готовность</small>
                        <b>
                          {Math.round(
                            (Number(w.actual) / Number(w.planned)) * 100,
                          )}
                          %
                        </b>
                      </div>
                      <div>
                        <small>Ответственный</small>
                        <b>{label("users", w.responsible_id)}</b>
                      </div>
                      <div>
                        <small>Подрядчик</small>
                        <b>{label("contractors", w.contractor_id)}</b>
                      </div>
                    </div>
                    {w.warnings.map((s: string) => (
                      <p className="notice" key={s}>
                        {s}
                      </p>
                    ))}
                    <div className="inline wrap">
                      {can("Planner") && (
                        <>
                          <button
                            className="primary"
                            onClick={() => newWork(w)}
                          >
                            Редактировать
                          </button>
                          <button
                            onClick={() =>
                              setModal({
                                kind: "progress",
                                id: w.id,
                                form: { delta: 0, reason: "" },
                              })
                            }
                          >
                            Корректировать факт
                          </button>
                          <button
                            onClick={() =>
                              setModal({
                                kind: "dependency",
                                form: {
                                  successor: w.id,
                                  predecessor: works.find((x) => x.id !== w.id)
                                    ?.id,
                                },
                              })
                            }
                          >
                            Зависимость
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => {
                          setSelectedWork(w.id);
                          setModal(null);
                          goto("inspector");
                        }}
                      >
                        Открыть инспектор
                      </button>
                    </div>
                    <h3 className="section-title">Предшественники</h3>
                    {data!.dependencies
                      .filter((d: Row) => d.successor === w.id)
                      .map((d: Row) => (
                        <div className="spread dependency-row" key={d.id}>
                          <span>
                            {label("works", d.predecessor, "code")} ·{" "}
                            {label("works", d.predecessor, "title")}
                          </span>
                          {can("Planner") && (
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  () =>
                                    api(
                                      `/projects/${pid}/dependencies/${d.id}`,
                                      "DELETE",
                                    ),
                                  "Зависимость удалена",
                                  false,
                                )
                              }
                            >
                              Убрать связь
                            </button>
                          )}
                        </div>
                      ))}
                    <h3 className="section-title">Проверки и доказательства</h3>
                    {inspectionCards(
                      data!.inspections.filter((i: Row) => i.work_id === w.id),
                    )}
                    <h3 className="section-title">Журнал объёмов</h3>
                    {data!.progress
                      .filter((p: Row) => p.work_id === w.id)
                      .map((p: Row) => (
                        <p key={p.id}>
                          {Number(p.delta) > 0 ? "+" : ""}
                          {num(p.delta)} {w.unit} · {p.reason}
                          <small>
                            {label("users", p.author_id)} · {time(p.created_at)}
                          </small>
                        </p>
                      ))}
                  </>
                );
              })()}
            {modal.kind === "media" &&
              (() => {
                const m = find("media", modal.id);
                return m ? (
                  <div>
                    {mediaView(m, true)}
                    <h3>{m.name}</h3>
                    <p>
                      Источник:{" "}
                      {m.source === "synthetic"
                        ? "ДЕМО · синтетический материал"
                        : "загруженный материал"}
                    </p>
                    <p className="muted">
                      Загрузка: {time(m.created_at)} · Съёмка:{" "}
                      {time(m.captured_at)}
                    </p>
                    <small className="checksum">SHA-256: {m.checksum}</small>
                  </div>
                ) : (
                  <div className="empty">Материал недоступен</div>
                );
              })()}
            {modal.kind === "audit" &&
              (() => {
                const a = find("audit", modal.id);
                return (
                  <div className="audit-diff">
                    <div>
                      <h4>До изменения</h4>
                      <pre>
                        {JSON.stringify(a?.before, null, 2) ||
                          "Нет предыдущего значения"}
                      </pre>
                    </div>
                    <div>
                      <h4>После изменения</h4>
                      <pre>{JSON.stringify(a?.after, null, 2)}</pre>
                    </div>
                  </div>
                );
              })()}
            {modal.kind === "work" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = modal.form;
                  const keys = [
                    "code",
                    "title",
                    "section",
                    "contractor_id",
                    "responsible_id",
                    "linear",
                    "axis_id",
                    "start_m",
                    "end_m",
                    "location",
                    "start_date",
                    "end_date",
                    "actual_start",
                    "actual_end",
                    "unit",
                    "planned",
                    "status",
                    "version",
                    "archived",
                    "reason",
                  ];
                  const payload = Object.fromEntries(
                    keys.map((k) => [k, f[k]]),
                  );
                  void run(() =>
                    api(
                      `/projects/${pid}/works${f.id ? "/" + f.id : ""}`,
                      f.id ? "PUT" : "POST",
                      payload,
                    ),
                  );
                }}
              >
                <div className="form-grid">
                  {input("Код работы", "code")}
                  {input("Раздел", "section")}
                </div>
                {input("Название работы", "title")}
                <div className="form-grid">
                  {selectField(
                    "Подрядчик",
                    "contractor_id",
                    data?.contractors || [],
                  )}
                  {selectField(
                    "Ответственный",
                    "responsible_id",
                    data?.users || [],
                  )}
                </div>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={modal.form.linear}
                    onChange={(e) => mf("linear", e.target.checked)}
                  />
                  Линейная работа
                </label>
                {modal.form.linear ? (
                  <>
                    {selectField(
                      "Ось / путь",
                      "axis_id",
                      (data?.axes || []).map((a: Row) => ({
                        ...a,
                        name: `${a.name} · путь ${a.path}`,
                      })),
                    )}
                    <div className="form-grid">
                      {input(
                        "Начало, м (ПК × 100 + добавка)",
                        "start_m",
                        "number",
                      )}
                      {input("Конец, м", "end_m", "number")}
                    </div>
                  </>
                ) : (
                  input("Описание места", "location")
                )}
                <div className="form-grid">
                  {input("Плановое начало", "start_date", "date")}
                  {input("Плановое окончание", "end_date", "date")}
                  {input("Плановый объём", "planned", "number")}
                  <label>
                    Единица
                    <select
                      value={modal.form.unit}
                      onChange={(e) => mf("unit", e.target.value)}
                    >
                      {["м", "м³", "м²", "шт", "т"].map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Статус
                    <select
                      value={modal.form.status}
                      onChange={(e) => mf("status", e.target.value)}
                    >
                      {["planned", "in_progress", "suspended", "completed"].map(
                        (s) => (
                          <option value={s} key={s}>
                            {statuses[s]}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <div />
                  {input("Фактическое начало", "actual_start", "date", false)}
                  {input("Фактическое окончание", "actual_end", "date", false)}
                </div>
                {input(
                  "Причина изменения / повторного открытия",
                  "reason",
                  "text",
                  false,
                )}
                {modal.form.id && (
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={modal.form.archived}
                      onChange={(e) => mf("archived", e.target.checked)}
                    />
                    Архивировать работу с сохранением истории
                  </label>
                )}
                <button className="primary full" disabled={busy}>
                  Сохранить работу
                </button>
              </form>
            )}
            {[
              "apply",
              "progress",
              "dependency",
              "remark",
              "reply",
              "equipment",
              "camera",
              "project",
              "projectEdit",
              "member",
              "axis",
              "contractor",
            ].includes(modal.kind) && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = modal.form;
                  const paths: Row = {
                    apply: [`inspections/${modal.id}/apply`, "POST", f],
                    progress: [`works/${modal.id}/progress`, "POST", f],
                    dependency: ["dependencies", "POST", f],
                    reply: [`remarks/${modal.id}/reply`, "POST", f],
                    equipment: ["equipment", "POST", f],
                    camera: ["cameras", "POST", f],
                    member: ["members", "PUT", f],
                    axis: ["axes", "POST", f],
                    contractor: ["contractors", "POST", f],
                  };
                  let path, method, body;
                  if (modal.kind === "remark") {
                    const w = find("works", f.work_id);
                    path = "remarks";
                    method = "POST";
                    body = { ...f, start_m: w?.start_m, end_m: w?.end_m };
                  } else if (["project", "projectEdit"].includes(modal.kind)) {
                    path = "";
                    method = modal.kind === "project" ? "POST" : "PATCH";
                    body = Object.fromEntries(
                      [
                        "code",
                        "name",
                        "description",
                        "start_date",
                        "end_date",
                      ].map((k) => [k, f[k]]),
                    );
                  } else {
                    [path, method, body] = paths[modal.kind];
                  }
                  const url =
                    modal.kind === "project"
                      ? "/projects"
                      : modal.kind === "projectEdit"
                        ? `/projects/${pid}`
                        : `/projects/${pid}/${path}`;
                  void run(async () => {
                    await api(url, method, body);
                    if (modal.kind.startsWith("project")) await bootstrap();
                  });
                }}
              >
                {modal.kind === "apply" && (
                  <p className="notice">
                    Будет принят дополнительный объём:{" "}
                    {num(find("inspections", modal.id)?.proposed)}{" "}
                    {label(
                      "works",
                      find("inspections", modal.id)?.work_id,
                      "unit",
                    )}
                    . Статус работы останется прежним.
                  </p>
                )}
                {modal.kind === "progress" &&
                  input("Изменение объёма (+ / −)", "delta", "number")}
                {["apply", "progress"].includes(modal.kind) &&
                  input("Причина решения", "reason")}
                {modal.kind === "dependency" &&
                  selectField(
                    "Предшествующая работа",
                    "predecessor",
                    works.filter((w) => w.id !== modal.form.successor),
                    "title",
                  )}
                {modal.kind === "remark" && (
                  <>
                    {selectField("Работа", "work_id", works, "title")}
                    {input("Описание замечания", "title")}
                    {selectField(
                      "Ответственный",
                      "responsible_id",
                      data?.users || [],
                    )}
                    {input("Срок устранения", "due_date", "date")}
                  </>
                )}
                {modal.kind === "reply" && (
                  <>
                    {input("Ответ / основание решения", "text")}
                    <label>
                      Состояние
                      <select
                        value={modal.form.status}
                        onChange={(e) => mf("status", e.target.value)}
                      >
                        {(can("RemoteInspector")
                          ? ["open", "in_progress", "resolved"]
                          : ["in_progress"]
                        ).map((s) => (
                          <option key={s} value={s}>
                            {statuses[s]}
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                {modal.kind === "equipment" && (
                  <>
                    {input("Название", "name")}
                    {input("Инвентарный номер", "inventory")}
                    {selectField(
                      "Подрядчик",
                      "contractor_id",
                      data?.contractors || [],
                    )}
                    {selectField("Ось", "axis_id", data?.axes || [])}
                  </>
                )}
                {modal.kind === "camera" && (
                  <>
                    {input("Название камеры", "name")}
                    {selectField(
                      "Техника",
                      "equipment_id",
                      data?.equipment || [],
                    )}
                  </>
                )}
                {["project", "projectEdit"].includes(modal.kind) && (
                  <>
                    {input("Код проекта", "code")}
                    {input("Название", "name")}
                    {input("Описание", "description", "text", false)}
                    <div className="form-grid">
                      {input("Начало", "start_date", "date")}
                      {input("Окончание", "end_date", "date")}
                    </div>
                  </>
                )}
                {modal.kind === "axis" && (
                  <>
                    {input("Название оси", "name")}
                    {input("Номер пути", "path")}
                    <div className="form-grid">
                      {input("Начало, м", "start_m", "number")}
                      {input("Конец, м", "end_m", "number")}
                    </div>
                  </>
                )}
                {modal.kind === "contractor" &&
                  input("Название подрядчика", "name")}
                {modal.kind === "member" && (
                  <>
                    {modal.form.email !== undefined
                      ? input(
                          "Email существующего пользователя",
                          "email",
                          "email",
                        )
                      : selectField(
                          "Пользователь",
                          "user_id",
                          data?.users || [],
                        )}
                    {Object.entries(roleNames).map(([key, title]) => (
                      <label key={key} className="checkbox">
                        <input
                          type="checkbox"
                          checked={modal.form.roles.includes(key)}
                          onChange={(e) =>
                            mf(
                              "roles",
                              e.target.checked
                                ? [...modal.form.roles, key]
                                : modal.form.roles.filter(
                                    (r: string) => r !== key,
                                  ),
                            )
                          }
                        />
                        {title}
                      </label>
                    ))}
                    {modal.form.roles.includes("ContractorManager") &&
                      selectField(
                        "Подрядчик",
                        "contractor_id",
                        data?.contractors || [],
                      )}
                  </>
                )}
                <button className="primary full" disabled={busy}>
                  {busy ? "Сохранение…" : "Сохранить"}
                </button>
              </form>
            )}
            {modal.kind === "upload" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  void run(
                    () => api(`/projects/${pid}/media`, "POST", form),
                    "Материал загружен",
                  );
                }}
              >
                <label>
                  Файл
                  <input
                    type="file"
                    name="file"
                    accept="image/jpeg,image/png,video/mp4,video/webm"
                    required
                  />
                </label>
                <label>
                  Камера
                  <select name="camera_id">
                    <option value="">Без привязки к камере</option>
                    {data?.cameras.map((c: Row) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Время съёмки с часовым поясом (если известно)
                  <input
                    name="captured_at"
                    placeholder="2026-11-12T10:30:00+03:00"
                  />
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    name="contractor_visible"
                    value="true"
                  />
                  Разрешить подрядчику доступ через связанные работы
                </label>
                <p className="muted">
                  JPEG / PNG до 20 МБ, MP4 / WebM до 200 МБ
                </p>
                <button className="primary full" disabled={busy}>
                  {busy ? "Загрузка…" : "Загрузить"}
                </button>
              </form>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
