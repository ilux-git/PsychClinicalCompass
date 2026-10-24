import { Fragment, lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
import { DoctorPatients } from "./DoctorPatients";
import { DoctorInbox, DoctorInboxNotice } from "./DoctorInbox";
import { TaskBoard } from "./TaskBoard";
import { RoleGuide } from "./RoleGuide";
import { NavigationGuard, useNavigationGuard } from "./NavigationGuard";
import { AnimatePresence, ContentFrame, m, motionTokens, useInteractionMotion } from "./Interaction";
import { SectionBoundary } from "./SectionBoundary";
import { ViewStateProvider, type PatientAnswerTarget, type ReturnPoint } from "./ViewState";

const DoctorDashboard = lazy(() => import("./DoctorDashboard").then(module => ({default:module.DoctorDashboard})));
const SurveyBuilder = lazy(() => import("./SurveyBuilder").then(module => ({default:module.SurveyBuilder})));
const PatientHome = lazy(() => import("./Patient").then(module => ({default:module.PatientHome})));
const AdminDashboard = lazy(() => import("./AdminDashboard").then(module => ({default:module.AdminDashboard})));

const doctorNav = [
  { id: "patients", title: "Мои пациенты", icon: Users },
  { id: "events", title: "События пациентов", icon: Bell },
  { id: "tasks", title: "Задачи пациентов", icon: ClipboardList },
  { id: "overview", title: "Аналитика сопровождения", icon: LayoutDashboard },
  { id: "state", title: "Состояние пациентов", icon: Activity },
  { id: "surveys", title: "Мои опросы", icon: ClipboardList },
  { id: "telegram", title: "Telegram · симулятор", icon: MessageCircle },
];
const patientNav = [
  { id: "overview", title: "Мой день", icon: HeartHandshake },
  { id: "surveys", title: "Мои опросы", icon: ClipboardList },
  { id: "state", title: "Моё состояние", icon: Activity },
  { id: "diary", title: "Мой дневник", icon: BookOpen },
  { id: "medications", title: "Расписание лекарств", icon: Pill },
  { id: "adherence", title: "Как получается", icon: HeartHandshake },
  { id: "chat", title: "Диалог с врачом", icon: MessageCircle },
  { id: "journey", title: "Маршрут и скидки", icon: Sparkles },
  { id: "telegram", title: "Telegram · симулятор", icon: Activity },
];
const adminNav = [
  {id:"overview",title:"Охват и опросы",icon:LayoutDashboard},
  {id:"barriers",title:"Барьеры и обратная связь",icon:HeartHandshake},
  {id:"actions",title:"Действия и исходы",icon:Activity},
  {id:"sources",title:"Источники и защита",icon:ShieldCheck},
];
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

function Workspace() {
  const guard = useNavigationGuard();
  const { moving, transition } = useInteractionMotion();
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(
    Boolean(sessionStorage.getItem("compass-token")),
  );
  const [view, setView] = useState("overview");
  const [navigationRevision,setNavigationRevision]=useState(0);
  const [inboxRevision, setInboxRevision] = useState(0);
  const [newSurvey, setNewSurvey] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<number | null>(null);
  const [patientEntry,setPatientEntry] = useState<"feedback"|"events"|"care">("feedback");
  const [patientOrigin,setPatientOrigin]=useState<{view:string;label:string;key:string}|null>(null);
  const [patientAnswer,setPatientAnswer]=useState<PatientAnswerTarget|null>(null);
  const [returnPoint,setReturnPoint]=useState<ReturnPoint|null>(null);
  const restored=useCallback(()=>setReturnPoint(null),[]);
  const [notice, setNotice] = useState<{
    message: string;
    kind: "success" | "error";
  } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const [guideStart, setGuideStart] = useState(0);
  useEffect(()=>{
    if(!menuOpen)return;
    const media=window.matchMedia("(max-width: 780px)");
    if(!media.matches){setMenuOpen(false);return;}
    const previous=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const focusable=()=>Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)')??[]).filter(element=>element.getClientRects().length);
    const frame=requestAnimationFrame(()=>focusable()[0]?.focus());
    const onKey=(event:KeyboardEvent)=>{
      if(document.querySelector('dialog[open]'))return;
      if(event.key==='Escape'){event.preventDefault();setMenuOpen(false);}
      if(event.key==='Tab'){
        const items=focusable(),first=items[0],last=items.at(-1);
        if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
      }
    };
    const onResize=()=>{if(!media.matches)setMenuOpen(false);};
    document.addEventListener('keydown',onKey);media.addEventListener('change',onResize);
    return()=>{cancelAnimationFrame(frame);document.removeEventListener('keydown',onKey);media.removeEventListener('change',onResize);document.body.style.overflow=overflow;if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[menuOpen]);
  const notify: Notify = useCallback(
    (message, kind = "success") => setNotice({ message, kind }),
    [],
  );
  useEffect(() => {
    if (!notice || notice.kind !== "success") return;
    const timer = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  const logout = useCallback(() => {
    sessionStorage.removeItem("compass-token");
    setUser(null);
    setView("overview");
    setSelectedPatient(null);
    setPatientEntry("feedback");
    setPatientOrigin(null);setReturnPoint(null);setPatientAnswer(null);
    setNotice(null);
    setGuideStart(0);
    setMenuOpen(false);
  }, []);
  useEffect(() => {
    let active = true;
    if (sessionStorage.getItem("compass-token"))
      api<User>("/auth/me")
        .then((data) => {
          if (active) {setUser(data); setView(data.role === "doctor" ? "patients" : "overview");}
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
  function navigate(next: string,after?:()=>void) {
    setMenuOpen(false);
    guard.run(() => {
    window.scrollTo(0,0);
    setView(next);
    setNavigationRevision(value=>value+1);
    if (next === "events") setInboxRevision((value) => value + 1);
    setSelectedPatient(null);
    setPatientEntry("feedback");
    setPatientOrigin(null);setReturnPoint(null);setPatientAnswer(null);
    setMenuOpen(false);
    setNewSurvey(false);
    after?.();
    });
  }
  function openPatient(id:number,options:{entry?:"feedback"|"events"|"care";returnKey?:string;answerTarget?:PatientAnswerTarget}={}) {
    setMenuOpen(false);
    guard.run(()=>{
      const labels:Record<string,string>={overview:"К аналитике сопровождения",events:"К событиям пациентов",tasks:"К задачам пациентов"};
      setPatientOrigin(labels[view]?{view,label:labels[view],key:options.returnKey??""}:null);
      setPatientAnswer(options.answerTarget??null);
      setReturnPoint(null);window.scrollTo(0,0);setSelectedPatient(id);setPatientEntry(options.entry??"feedback");setView("patients");setMenuOpen(false);
    });
  }
  function returnFromPatient() {
    setSelectedPatient(null);
    if(patientOrigin){setReturnPoint({scope:patientOrigin.view,key:patientOrigin.key});setView(patientOrigin.view);setNavigationRevision(value=>value+1);}
    else if(selectedPatient!==null)setReturnPoint({scope:view,key:`directory-${selectedPatient}`});
    setPatientOrigin(null);
    setPatientAnswer(null);
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
  if (!user) return <Login onLogin={value => {setUser(value); setView(value.role === "doctor" ? "patients" : "overview");}} />;
  const nav =
    user.role === "doctor"
      ? doctorNav
      : user.role === "patient"
        ? patientNav
        : user.role === "coordinator" ? coordinatorNav : adminNav;
  const navSections:Record<string,string> = user.role === "doctor" ? {patients:"Рабочий день",overview:"Наблюдение",surveys:"Инструменты",telegram:"Демонстрация"} : user.role === "patient" ? {overview:"Между встречами",journey:"Участие",telegram:"Демонстрация"} : {};
  return (
    <ViewStateProvider key={user.id} returnPoint={returnPoint} restored={restored}><div
      className={`app-shell ${user.role === "patient" ? "patient-shell" : ""}`}
    >
      <a className="skip-link" href="#compass-main">Перейти к содержимому</a>
      <aside ref={sidebar} className={`sidebar ${menuOpen ? "open" : ""}`} role={menuOpen?"dialog":undefined} aria-modal={menuOpen||undefined} aria-label="Меню кабинета">
        <a
          href="/"
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            navigate(user.role === "doctor" ? "patients" : "overview");
          }}
        >
          <span className="brand-mark">
            <Activity size={23} />
          </span>
          <span>
            clinical<span className="brand-light">compass</span>
          </span>
        </a>
        <div className="workspace-heading"><div className="workspace-label">
          {user.role === "doctor"
            ? "Пространство врача"
            : user.role === "patient"
              ? "Моё пространство"
              : user.role === "coordinator" ? "Координатор" : "Администратор"}
        </div><button type="button" className="icon-button drawer-close" aria-label="Закрыть навигацию" onClick={()=>setMenuOpen(false)}><X size={18}/></button></div>
        <nav aria-label="Главная навигация">
          {nav.map((item) => <Fragment key={item.id}>
            {navSections[item.id]&&<p className="nav-section-label">{navSections[item.id]}</p>}
            <button
              key={item.id}
              className={view === item.id ? "active" : ""}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => navigate(item.id)}
            >
              <item.icon size={19} />
              <span>{item.title}</span>
              {view === item.id && <i />}
            </button>
          </Fragment>)}
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
          <button className="icon-button" onClick={() => {setMenuOpen(false);guard.run(logout);}} aria-label="Выйти">
            <LogOut size={18} />
          </button>
        </div>
      </aside>
      {menuOpen && (
        <button
          className="menu-backdrop"
          tabIndex={-1}
          aria-label="Закрыть меню"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div className="main-shell" inert={menuOpen}>
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Открыть меню"
            aria-expanded={menuOpen}
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
            {user.role === "doctor" && <DoctorInboxNotice key={user.id} open={() => navigate("events")} />}
            <Button variant="ghost" onClick={() => guard.run(() => {navigate(user.role === "doctor" ? "patients" : "overview"); setGuideStart(v => v+1); setMenuOpen(false);})}><BookOpen size={16}/> Как пользоваться</Button>
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
        <main className="main-content" id="compass-main" tabIndex={-1} key={user.id}>
          <AnimatePresence initial={false}>{notice && (
            <m.div
              key={notice.message}
              initial={{opacity:0,y:moving?motionTokens.distance.medium:0}}
              animate={{opacity:1,y:0}} exit={{opacity:0,y:moving?motionTokens.distance.small:0}} transition={transition}
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
            </m.div>
          )}</AnimatePresence>
          <RoleGuide key={user.id} user={user} navigate={navigate} startSignal={guideStart}/>
          <AnimatePresence mode="wait" initial={false}><ContentFrame key={`${view}-${navigationRevision}`}>
          <SectionBoundary key={`${user.id}-${view}`} refresh={()=>guard.run(()=>window.location.reload())}>
          <Suspense fallback={<div className="route-loading"><Loading/></div>}>
          {user.role === "doctor" ? (
            view === "overview" ? (
              <DoctorDashboard
                openPatient={(id,key,answerTarget)=>openPatient(id,{returnKey:key,answerTarget})}
                createSurvey={() => navigate("surveys",()=>setNewSurvey(true))}
              />
            ) : view === "tasks" ? (
              <TaskBoard notify={notify} choosePatient={() => navigate("patients")} openPatient={(id,key)=>openPatient(id,{entry:"care",returnKey:key})} />
            ) : view === "events" ? (
              <DoctorInbox key={inboxRevision} openPatient={(id,key)=>openPatient(id,{entry:"events",returnKey:key})} />
            ) : view === "surveys" ? (
              <SurveyBuilder notify={notify} initialNew={newSurvey} />
            ) : (
              <DoctorPatients
                key={view}
                selected={selectedPatient}
                onSelect={setSelectedPatient}
                back={returnFromPatient}
                backLabel={patientOrigin?.label}
                scope={view}
                initialAnswer={patientAnswer??undefined}
                notify={notify}
                simulated={view === "telegram"}
                initialTab={view === "state" ? "clinical" : patientEntry}
                openTasks={() => navigate("tasks")}
              />
            )
          ) : user.role === "patient" ? (
            <PatientHome key={view} user={user} view={view} notify={notify} navigate={navigate}/>
          ) : user.role === "coordinator" ? (
            <TaskBoard operational notify={notify} />
          ) : (
            <AdminDashboard view={view} navigate={navigate}/>
          )}
          </Suspense>
          </SectionBoundary>
          </ContentFrame></AnimatePresence>
        </main>
        <footer className="app-footer">
          Clinical Compass · учебный MVP{" "}
          <span>Поддержка диалога между врачом и пациентом</span>
        </footer>
      </div>
    </div></ViewStateProvider>
  );
}

export default function App() {
  return <NavigationGuard><Workspace/></NavigationGuard>;
}
