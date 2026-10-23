import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Activity,
  LayoutDashboard,
  Users,
  ClipboardList,
  MessageCircle,
  LogOut,
  X,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  HeartHandshake,
  ShieldCheck,
  Sparkles,
  Menu,
  Bell,
  BookOpen,
  Pill,
} from "lucide-react";
import { api, send, type User } from "./api";
import {
  Avatar,
  Badge,
  Button,
  ErrorBox,
  Loading,
  availability,
  type Notify,
} from "./UI";
import { DoctorDashboard } from "./DoctorDashboard";
import { DoctorPatients } from "./DoctorPatients";
import { SurveyBuilder } from "./SurveyBuilder";
import { PatientHome } from "./Patient";
import { DoctorInbox, DoctorInboxNotice } from "./DoctorInbox";
import { AdminDashboard } from "./AdminDashboard";
import { CoordinatorHome } from "./CareWorkflow";

const doctorNav = [
  { id: "overview", title: "Обзор обратной связи", icon: LayoutDashboard },
  { id: "events", title: "События пациентов", icon: Bell },
  { id: "patients", title: "Мои пациенты", icon: Users },
  { id: "state", title: "Состояние пациентов", icon: Activity },
  { id: "surveys", title: "Мои опросы", icon: ClipboardList },
  { id: "telegram", title: "Telegram · симулятор", icon: MessageCircle },
];
const patientNav = [
  { id: "overview", title: "Мои опросы", icon: ClipboardList },
  { id: "state", title: "Моё состояние", icon: Activity },
  { id: "diary", title: "Мой дневник", icon: BookOpen },
  { id: "medications", title: "Расписание лекарств", icon: Pill },
  { id: "adherence", title: "Как получается", icon: HeartHandshake },
  { id: "chat", title: "Диалог с врачом", icon: MessageCircle },
  { id: "telegram", title: "Telegram · симулятор", icon: Activity },
];
const adminNav = [{ id: "overview", title: "Общая сводка", icon: LayoutDashboard }];
const coordinatorNav = [{id: "overview", title: "Мои задачи", icon: ClipboardList}];

function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [username, setUsername] = useState("doctor");
  const [password, setPassword] = useState("doctor-pass-123");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState("doctor");
  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await send<{ access_token: string; user: User }>(
        "/auth/login",
        { username, password },
      );
      sessionStorage.setItem("compass-token", result.access_token);
      onLogin(result.user);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Нет соединения с сервером",
      );
    } finally {
      setBusy(false);
    }
  }
  function select(value: string) {
    setPreset(value);
    setUsername(value);
    setPassword(
      value.startsWith("patient")
        ? "patient-pass-123"
        : value === "admin"
          ? "admin-pass-123"
          : value === "coordinator" ? "coordinator-pass-123"
          : "doctor-pass-123",
    );
  }
  return (
    <div className="login-page">
      <div className="login-story">
        <a href="/" className="brand">
          <span className="brand-mark">
            <Activity size={24} />
          </span>
          <span>
            clinical<span className="brand-light">compass</span>
          </span>
        </a>
        <div className="login-story-main">
          <Badge tone="purple">Сопровождение между визитами</Badge>
          <h1>
            Ближе к пациенту.
            <br />
            <span>Понятнее, что мешает.</span>
          </h1>
          <p>
            Услышать обратную связь, заметить сложности и подобрать следующий
            шаг вместе с пациентом.
          </p>
          <div className="story-visual" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="story-heart">
              <HeartHandshake size={74} strokeWidth={1.25} />
            </div>
            <div className="story-pill pill-one">
              <MessageCircle size={17} /> Голос пациента
            </div>
            <div className="story-pill pill-two">
              <Sparkles size={17} /> Маленькие шаги
            </div>
            <div className="story-pill pill-three">
              <CheckCircle2 size={17} /> Обратная связь врачу
            </div>
          </div>
        </div>
        <p className="login-footer">
          <ShieldCheck size={16} /> Учебный стенд · только синтетические данные
        </p>
      </div>
      <div className="login-form-side">
        <form className="login-form" onSubmit={login}>
          <p className="eyebrow">Добро пожаловать</p>
          <h2>Войти в Compass</h2>
          <p className="muted">
            Выберите роль для демонстрации или введите данные учётной записи.
          </p>
          <label className="field">
            Демонстрационная роль
            <select value={preset} onChange={(e) => select(e.target.value)}>
              <option value="doctor">Врач · основные пациенты</option>
              <option value="doctor2">Второй врач · отдельные пациенты</option>
              {Array.from({ length: 10 }, (_, i) => (
                <option key={i} value={`patient${i + 1}`}>
                  Пациент {i + 1}
                  {i === 5
                    ? " · ждёт ответов"
                    : i === 7
                      ? " · пока без назначений"
                      : ""}
                </option>
              ))}
              <option value="admin">
                Администратор · обезличенная сводка
              </option>
              <option value="coordinator">Координатор · назначенные задачи</option>
            </select>
          </label>
          <label className="field">
            Логин
            <input
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="field">
            Пароль
            <input
              type="password"
              autoComplete="current-password"
              required
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <ErrorBox message={error} />
          <Button disabled={busy} type="submit">
            {busy ? "Входим…" : "Войти"}
            <ArrowRight size={17} />
          </Button>
          <p className="field-hint">
            Доступны только ваши пациенты и ответы. Кабинет администратора не
            открывает медицинские карточки.
          </p>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(
    Boolean(sessionStorage.getItem("compass-token")),
  );
  const [view, setView] = useState("overview");
  const [inboxRevision, setInboxRevision] = useState(0);
  const [newSurvey, setNewSurvey] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<number | null>(null);
  const [notice, setNotice] = useState<{
    message: string;
    kind: "success" | "error";
  } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const notify: Notify = useCallback(
    (message, kind = "success") => setNotice({ message, kind }),
    [],
  );
  const logout = useCallback(() => {
    sessionStorage.removeItem("compass-token");
    setUser(null);
    setView("overview");
    setSelectedPatient(null);
    setNotice(null);
  }, []);
  useEffect(() => {
    let active = true;
    if (sessionStorage.getItem("compass-token"))
      api<User>("/auth/me")
        .then((data) => {
          if (active) setUser(data);
        })
        .catch(() => {
          if (active) logout();
        })
        .finally(() => {
          if (active) setBooting(false);
        });
    window.addEventListener("compass-auth-expired", logout);
    return () => {
      active = false;
      window.removeEventListener("compass-auth-expired", logout);
    };
  }, [logout]);
  function navigate(next: string) {
    setView(next);
    if (next === "events") setInboxRevision((value) => value + 1);
    setSelectedPatient(null);
    setMenuOpen(false);
    setNotice(null);
    setNewSurvey(false);
  }
  async function changeAvailability(value: string) {
    try {
      await send("/doctors/me/availability", { availability: value }, "PATCH");
      setUser((current) =>
        current ? { ...current, availability: value } : current,
      );
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Не удалось обновить статус",
        "error",
      );
    }
  }
  if (booting)
    return (
      <div className="boot">
        <Loading />
      </div>
    );
  if (!user) return <Login onLogin={setUser} />;
  const nav =
    user.role === "doctor"
      ? doctorNav
      : user.role === "patient"
        ? patientNav
        : user.role === "coordinator" ? coordinatorNav : adminNav;
  return (
    <div
      className={`app-shell ${user.role === "patient" ? "patient-shell" : ""}`}
    >
      <aside className={`sidebar ${menuOpen ? "open" : ""}`}>
        <a
          href="/"
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            navigate("overview");
          }}
        >
          <span className="brand-mark">
            <Activity size={23} />
          </span>
          <span>
            clinical<span className="brand-light">compass</span>
          </span>
        </a>
        <div className="workspace-label">
          {user.role === "doctor"
            ? "Пространство врача"
            : user.role === "patient"
              ? "Моё пространство"
              : user.role === "coordinator" ? "Координатор" : "Администратор"}
        </div>
        <nav aria-label="Главная навигация">
          {nav.map((item) => (
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} />
              <span>{item.title}</span>
              {view === item.id && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-support">
          <span className="support-icon">
            <HeartHandshake size={25} />
          </span>
          <strong>
            {user.role === "doctor"
              ? "За цифрами — человек"
              : user.role === "admin" ? "Общая картина клиники" : user.role === "coordinator" ? "Помочь со следующим шагом" : "Каждый ответ важен"}
          </strong>
          <p>
            {user.role === "doctor"
              ? "Обратная связь помогает начать нужный разговор."
              : user.role === "admin" ? "Охват и препятствия без персональных данных." : user.role === "coordinator" ? "Назначенные организационные задачи и выполненные действия." : "Расскажите, какая поддержка нужна именно вам."}
          </p>
        </div>
        <div className="sidebar-profile">
          <Avatar name={user.display_name} small />
          <div>
            <strong>{user.display_name}</strong>
            <small>
              {user.role === "doctor"
                ? "Врач"
                : user.role === "patient"
                  ? "Пациент"
                  : user.role === "coordinator" ? "Координатор" : "Администратор"}
            </small>
          </div>
          <button className="icon-button" onClick={logout} aria-label="Выйти">
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="menu-backdrop"
          aria-label="Закрыть меню"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Открыть меню"
            onClick={() => setMenuOpen(true)}
          >
            <Menu size={22} />
          </button>
          <span className="mobile-brand">Compass</span>
          <span className="breadcrumb">
            {user.role === "doctor"
              ? "Кабинет врача"
              : user.role === "patient"
                ? "Мой кабинет"
                : user.role === "coordinator" ? "Кабинет координатора" : "Управление"}
            <span>/</span>
            <strong>
              {nav.find((item) => item.id === view)?.title ?? "Доступ"}
            </strong>
          </span>
          <div className="topbar-actions">
            <Badge tone="purple">Демо · синтетические данные</Badge>
            {user.role === "doctor" && (
              <label className="availability-select">
                <span
                  className={`availability-dot ${user.availability === "available" ? "online" : ""}`}
                />
                <span className="sr-only">Доступность врача</span>
                <select
                  value={user.availability}
                  onChange={(e) => changeAvailability(e.target.value)}
                >
                  {Object.entries(availability).map(([value, title]) => (
                    <option key={value} value={value}>
                      {title}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </header>
        {user.role === "doctor" && <DoctorInboxNotice key={user.id} open={() => navigate("events")} />}
        <main className="main-content" key={`${user.id}-${view}`}>
          {notice && (
            <div
              className={`toast ${notice.kind}`}
              role={notice.kind === "error" ? "alert" : "status"}
            >
              {notice.kind === "success" ? (
                <CheckCircle2 size={18} />
              ) : (
                <AlertCircle size={18} />
              )}
              <span>{notice.message}</span>
              <button
                className="icon-button"
                aria-label="Закрыть уведомление"
                onClick={() => setNotice(null)}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {user.role === "doctor" ? (
            view === "overview" ? (
              <DoctorDashboard
                openPatient={(id) => {
                  setSelectedPatient(id);
                  setView("patients");
                }}
                createSurvey={() => {
                  navigate("surveys");
                  setNewSurvey(true);
                }}
              />
            ) : view === "events" ? (
              <DoctorInbox key={inboxRevision} openPatient={(id) => {
                setSelectedPatient(id);
                setView("state");
              }} />
            ) : view === "surveys" ? (
              <SurveyBuilder notify={notify} initialNew={newSurvey} />
            ) : (
              <DoctorPatients
                selected={selectedPatient}
                onSelect={setSelectedPatient}
                notify={notify}
                simulated={view === "telegram"}
                initialTab={view === "state" ? "clinical" : "feedback"}
              />
            )
          ) : user.role === "patient" ? (
            <PatientHome user={user} view={view} notify={notify} />
          ) : user.role === "coordinator" ? (
            <CoordinatorHome notify={notify} />
          ) : (
            <AdminDashboard />
          )}
        </main>
        <footer className="app-footer">
          Clinical Compass · учебный MVP{" "}
          <span>Поддержка диалога между врачом и пациентом</span>
        </footer>
      </div>
    </div>
  );
}
