import {accountName} from "./presentation";
import { Fragment, lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
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
  House,
  ListTodo,
  CircleHelp,
  Settings2,
} from "lucide-react";
import { api, send, sessionToken, saveSessionToken, clearSessionToken, type User } from "./api";
import {
  Avatar,
  Badge,
  Button,
  ErrorBox,
  Loading,
  availability,
  type Notify,
} from "./UI";
import { DoctorInbox, DoctorInboxNotice } from "./DoctorInbox";
import { RoleGuide } from "./RoleGuide";
import { NavigationGuard, useNavigationGuard } from "./NavigationGuard";
import { AnimatePresence, m, motionTokens, useInteractionMotion, usePendingSelectFocus } from "./Interaction";
import { SectionBoundary } from "./SectionBoundary";
import { ViewStateProvider, type PatientAnswerTarget, type ReturnPoint } from "./ViewState";
import { cardSections, defaultView, navigationFor, patientSurveyGuide, sectionFor, type NavItem, type CardTab } from "./navigation";
import { WorkspaceHome } from "./WorkspaceHome";
import { CoordinatorNotices } from "./CoordinatorFallback";
import { BrandIdentity, productName } from "./Brand";
import { createWorkspaceHistory, pageRoute, routeHref as workspaceHref, type RouteContext, type WorkspaceRoute } from "./routes";
import { applicationBase, isTelegramPath, telegramWebApp } from "./telegramRuntime";
import { TelegramHost } from "./TelegramEntry";
import { Login } from "./Login";
import { AccountSettings } from "./AccountSettings";

const routeHref=(route:WorkspaceRoute)=>workspaceHref(route,applicationBase(window.location.pathname));

const DoctorDashboard = lazy(() => import("./DoctorDashboard").then(module => ({default:module.DoctorDashboard})));
const SurveyBuilder = lazy(() => import("./SurveyBuilder").then(module => ({default:module.SurveyBuilder})));
const PatientHome = lazy(() => import("./Patient").then(module => ({default:module.PatientHome})));
const AdminDashboard = lazy(() => import("./AdminDashboard").then(module => ({default:module.AdminDashboard})));
const DoctorPatients = lazy(() => import("./DoctorPatients").then(module => ({default:module.DoctorPatients})));
const TaskBoard = lazy(() => import("./TaskBoard").then(module => ({default:module.TaskBoard})));

const navIcons:Record<string,typeof Users>={home:House,users:Users,bell:Bell,tasks:ListTodo,surveys:ClipboardList,chart:LayoutDashboard,activity:Activity,chat:MessageCircle,heart:HeartHandshake,sparkles:Sparkles,book:BookOpen,pill:Pill,shield:ShieldCheck};


function Workspace() {
  const guard = useNavigationGuard();
  const { moving, transition } = useInteractionMotion();
  const [user, setUser] = useState<User | null>(null);
  const sessionEpoch = useRef(0);
  const [sessionMessage, setSessionMessage] = useState("");
  const [settingsOpen,setSettingsOpen]=useState(false);
  const currentUser=useRef(user);currentUser.current=user;
  const [availabilityPending,setAvailabilityPending]=useState<{doctorId:number;value:string}|null>(null);
  const [availabilityError,setAvailabilityError]=useState<{doctorId:number;message:string}|null>(null);
  const availabilityBusy=Boolean(user&&availabilityPending?.doctorId===user.id);
  const availabilityFocus=usePendingSelectFocus(availabilityBusy),availabilityId=useId();
  useEffect(()=>setAvailabilityError(null),[user?.id]);
  const [booting, setBooting] = useState(
    !isTelegramPath()&&Boolean(sessionToken()),
  );
  const [view, setView] = useState("overview");
  const [navigationRevision,setNavigationRevision]=useState(0);
  const [inboxRevision, setInboxRevision] = useState(0);
  const [newSurvey, setNewSurvey] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState<number | null>(null);
  const [patientEntry,setPatientEntry] = useState<CardTab>("feedback");
  const [selectedAssignment,setSelectedAssignment]=useState<number|null>(null);
  const navigationView=user?.role==="patient"&&selectedAssignment!==null?"surveys":view;
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
  const primaryNavigation = useRef<HTMLElement>(null);
  const [guideStart, setGuideStart] = useState(0);
  const historyNavigation=useRef<ReturnType<typeof createWorkspaceHistory>|null>(null);
  const locationSnapshot=useRef<{route:WorkspaceRoute;context:RouteContext}|null>(null);
  const applyLocation=useRef<(route:WorkspaceRoute,context:RouteContext)=>void>(()=>{});
  applyLocation.current=(next,context)=>{
    const previous=locationSnapshot.current;
    const origin=previous?.context.origin;
    const returned=context.returnPoint??(origin&&origin.view===next.view&&next.patientId===null?{scope:origin.view,key:origin.key}:null);
    locationSnapshot.current={route:next,context};
    setView(next.view);setSelectedPatient(next.patientId);setPatientEntry(next.cardTab);setSelectedAssignment(next.assignmentId);
    setPatientOrigin(context.origin?{...context.origin,label:`К разделу «${sectionFor(user?.role??"doctor",context.origin.view).title}»`}:null);
    setPatientAnswer(context.answer??null);setReturnPoint(returned);setMenuOpen(false);setNewSurvey(false);
    const pageChanged=!previous||previous.route.view!==next.view||previous.route.patientId!==next.patientId||previous.route.assignmentId!==next.assignmentId;
    if(previous&&previous.route.view!==next.view)setNavigationRevision(value=>value+1);
    if(pageChanged){window.scrollTo(0,0);requestAnimationFrame(()=>{
      const active=document.activeElement,main=document.getElementById("compass-main");
      if(active&&active!==main&&active.closest("[data-page-location]")?.getAttribute("data-page-location")===routeHref(next))return;
      main?.focus({preventScroll:true});
    });}
  };
  useEffect(()=>{
    if(!user)return;
    const controller=createWorkspaceHistory({role:user.role,owner:user.id,approve:(action,target)=>{
      setMenuOpen(false);
      const current=locationSnapshot.current?.route;
      if(current&&current.patientId!==null&&current.patientId===target.patientId&&current.view===target.view)guard.runFor(action,"patient-card-tab");else guard.run(action);
    },apply:(route,context)=>applyLocation.current(route,context),port:{
      href:()=>window.location.href,state:()=>window.history.state,
      push:(state,href)=>window.history.pushState(state,"",href),replace:(state,href)=>window.history.replaceState(state,"",href),
      go:delta=>window.history.go(delta),listen:callback=>{window.addEventListener("popstate",callback);return()=>window.removeEventListener("popstate",callback);},
    }});
    historyNavigation.current=controller;
    return()=>{controller.dispose();historyNavigation.current=null;};
  },[user?.id,user?.role,guard.run,guard.runFor]);
  useEffect(()=>{
    const title=!user?"Вход":selectedPatient!==null?cardSections[patientEntry].title:selectedAssignment!==null?"Ответ на опрос":sectionFor(user.role,view).title;
    document.title=`${title} · ${productName}`;
  },[user?.role,view,selectedPatient,patientEntry,selectedAssignment]);
  useLayoutEffect(()=>{
    const nav=primaryNavigation.current;
    if(!nav)return;
    const revealCurrent=()=>{
      const selected=nav.querySelector<HTMLElement>('a[aria-current="page"]');
      if(!selected||!nav.clientHeight)return;
      const focused=document.activeElement;
      if(focused&&nav.contains(focused)&&focused!==selected)return;
      const viewport=nav.getBoundingClientRect(),item=selected.getBoundingClientRect();
      const delta=item.top<viewport.top?item.top-viewport.top-8:item.bottom>viewport.bottom?item.bottom-viewport.bottom+8:0;
      if(delta)nav.scrollTo({top:nav.scrollTop+delta,behavior:moving?"smooth":"instant"});
    };
    revealCurrent();
    const observer=typeof ResizeObserver==="undefined"?null:new ResizeObserver(revealCurrent);
    observer?.observe(nav);
    window.addEventListener("resize",revealCurrent);
    return()=>{observer?.disconnect();window.removeEventListener("resize",revealCurrent);};
  },[user?.id,user?.role,navigationView,menuOpen,moving]);
  useEffect(()=>{
    if(!menuOpen)return;
    const media=window.matchMedia("(max-width: 780px)");
    if(!media.matches){setMenuOpen(false);return;}
    const previous=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const focusable=()=>Array.from(sidebar.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),select:not(:disabled)')??[]).filter(element=>element.getClientRects().length);
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
    (message, kind = "success") => {
      if(currentUser.current?.id!==user?.id||currentUser.current?.role!==user?.role)return;
      setNotice({ message, kind });
    },
    [user?.id,user?.role],
  );
  useEffect(() => {
    if (!notice || notice.kind !== "success") return;
    const timer = setTimeout(() => setNotice(null), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  const logout = useCallback(() => {
    sessionEpoch.current += 1;
    setSessionMessage("Сессия завершена. Войдите снова.");
    setSettingsOpen(false);
    historyNavigation.current?.dispose();historyNavigation.current=null;locationSnapshot.current=null;
    window.history.replaceState(null,"",window.location.pathname);
    clearSessionToken();
    setUser(null);
    setView("overview");
    setSelectedPatient(null);
    setPatientEntry("feedback");
    setSelectedAssignment(null);
    setPatientOrigin(null);setReturnPoint(null);setPatientAnswer(null);
    setNotice(null);
    setGuideStart(0);
    setMenuOpen(false);
  }, []);
  function signOut() {
    const token = sessionToken();
    // Start while api() can still capture this credential. Local exit never waits for transport.
    const request = token ? api<{revoked:boolean}>("/auth/logout", {method:"POST"}) : null;
    logout();
    if (!request) return;
    const exitEpoch = sessionEpoch.current;
    const stillSignedOut = () => sessionEpoch.current === exitEpoch && !sessionToken();
    setSessionMessage("Вы вышли на этом устройстве. Завершаем сессию…");
    void request.then(result => {
      if (result.revoked !== true) throw new Error("Revocation was not confirmed");
      if (stillSignedOut()) setSessionMessage("Вы вышли из учётной записи.");
    }).catch(() => {
      if (stillSignedOut()) setSessionMessage("Вы вышли на этом устройстве. Завершение сессии на сервере не подтверждено.");
    });
  }
  useEffect(() => {
    let active = true;
    if (!isTelegramPath()&&sessionToken())
      api<User>("/auth/me")
        .then((data) => {
          if (active) {setUser(data); setView(defaultView(data.role));}
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
  useEffect(()=>{
    if(!isTelegramPath()||!user)return;
    const back=telegramWebApp()?.BackButton;
    if(!back)return;
    const current=locationSnapshot.current?.route;
    const canBack=Boolean(current&&(current.view!==defaultView(user.role)||current.patientId!==null||current.assignmentId!==null));
    if(canBack)back.show();else back.hide();
    const goBack=()=>{
      setMenuOpen(false);
      if(historyNavigation.current&&historyNavigation.current.current().entry.index>0)window.history.back();
      else guard.run(()=>historyNavigation.current?.push(pageRoute(user.role,defaultView(user.role))));
    };
    back.onClick(goBack);
    return()=>{back.offClick(goBack);back.hide();};
  },[user?.id,user?.role,view,selectedPatient,selectedAssignment,guard.run]);
  function navigate(next: string,after?:()=>void) {
    setMenuOpen(false);
    guard.run(() => {
    if(!user)return;
    historyNavigation.current?.push(pageRoute(user.role,next));
    if(next===view)setNavigationRevision(value=>value+1);
    if (next === "events") setInboxRevision((value) => value + 1);
    setNewSurvey(false);
    after?.();
    });
  }
  function openPatient(id:number,options:{entry?:CardTab;returnKey?:string;answerTarget?:PatientAnswerTarget}={}) {
    setMenuOpen(false);
    guard.run(()=>{
      if(!user)return;
      const targetView=["patients","state","telegram"].includes(view)?view:"patients";
      const target={...pageRoute(user.role,targetView),patientId:id,cardTab:options.entry??(targetView==="state"?"clinical":targetView==="telegram"?"chat":"feedback") as CardTab};
      historyNavigation.current?.push(target,{origin:["overview","events","tasks"].includes(view)?{view,key:options.returnKey??""}:undefined,answer:options.answerTarget});
    });
  }
  function returnFromPatient() {
    if(!user)return;
    const target=patientOrigin?.view??view;
    historyNavigation.current?.push(pageRoute(user.role,target),{returnPoint:{scope:target,key:patientOrigin?.key??`directory-${selectedPatient}`}});
  }
  function changePatientTab(tab:CardTab) {
    const snapshot=locationSnapshot.current;
    if(snapshot)historyNavigation.current?.push({...snapshot.route,cardTab:tab},snapshot.context);
  }
  function selectAssignment(id:number) {
    setMenuOpen(false);
    guard.run(()=>{const snapshot=locationSnapshot.current;if(snapshot)historyNavigation.current?.push({...snapshot.route,assignmentId:id},snapshot.context);});
  }
  async function changeAvailability(value: string) {
    if(!user||user.role!=="doctor"||availabilityBusy)return;
    const doctorId=user.id;
    availabilityFocus.remember();
    setAvailabilityPending({doctorId,value});setAvailabilityError(null);
    try {
      await send("/doctors/me/availability", { availability: value }, "PATCH");
      setUser((current) =>
        current?.id===doctorId&&current.role==="doctor" ? { ...current, availability: value } : current,
      );
    } catch (error) {
      if(currentUser.current?.id===doctorId&&currentUser.current.role==="doctor") {
        const message=error instanceof Error?error.message:"Не удалось обновить статус";
        setAvailabilityError({doctorId,message});
        const control=availabilityFocus.ref.current;
        if(!control||!control.getClientRects().length||control.closest('[inert]')||getComputedStyle(control).visibility==="hidden")notify(message,"error");
      }
    } finally {
      setAvailabilityPending(current=>current?.doctorId===doctorId?null:current);
    }
  }
  if (booting)
    return (
      <div className="boot">
        <Loading />
      </div>
    );
  if (!user) {
    const onLogin=(value:User)=>{sessionEpoch.current+=1;setSessionMessage("");setUser(value);setView(defaultView(value.role));};
    return <Login key={sessionEpoch.current} sessionMessage={sessionMessage} onLogin={onLogin}/>;
  }
  const nav=navigationFor(user.role);
  const currentSection=sectionFor(user.role,navigationView);
  const primaryNav=nav.filter(item=>!item.secondary);
  const secondaryNav=nav.filter(item=>item.secondary);
  const quickNav=user.role==="doctor"?[["home","Главная"],["patients","Пациенты"],["events","События"],["tasks","План"]]:user.role==="patient"?[["overview","Мой день"],["surveys","Опросы"],["diary","Дневник"],["chat","Чат"]]:user.role==="admin"?[["overview","Обзор"],["barriers","Затруднения"],["actions","Действия"],["sources","Данные"]]:[];
  function navControl(item:NavItem) {
    const Icon=navIcons[item.icon];
    return <a href={routeHref(pageRoute(user!.role,item.id))} className={navigationView===item.id?"active":""} aria-current={navigationView===item.id?"page":undefined} onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&event.button===0){event.preventDefault();navigate(item.id);}}}>
      <Icon size={19}/><span className="nav-item-copy"><strong>{item.title}</strong><small>{item.description}</small></span>{navigationView===item.id&&<i/>}
    </a>;
  }
  return (
    <ViewStateProvider key={`${user.id}-${user.role}`} returnPoint={returnPoint} restored={restored}><div
      className={`app-shell ${user.role === "patient" ? "patient-shell" : ""}`}
    >
      <a className="skip-link" href="#compass-main" onClick={event=>{event.preventDefault();document.getElementById("compass-main")?.focus();document.getElementById("compass-main")?.scrollIntoView({block:"start"});}}>Перейти к содержимому</a>
      <aside ref={sidebar} className={`sidebar ${menuOpen ? "open" : ""}`} role={menuOpen?"dialog":undefined} aria-modal={menuOpen||undefined} aria-label="Меню кабинета">
        <a
          href={applicationBase(window.location.pathname)}
          className="brand"
          onClick={(event) => {
            event.preventDefault();
            navigate(defaultView(user.role));
          }}
        >
          <BrandIdentity/>
        </a>
        <div className="workspace-heading"><div className="workspace-label">
          {user.role === "doctor"
                ? "Кабинет врача"
            : user.role === "patient"
              ? "Кабинет пациента"
              : user.role === "coordinator" ? "Координатор" : "Администратор"}
        </div><button type="button" className="icon-button drawer-close" aria-label="Закрыть навигацию" onClick={()=>setMenuOpen(false)}><X size={18}/></button></div>
        <nav ref={primaryNavigation} aria-label="Главная навигация">
          {primaryNav.map((item,index)=><Fragment key={item.id}>
            {item.group&&primaryNav[index-1]?.group!==item.group&&<p className="nav-section-label">{item.group}</p>}
            {navControl(item)}
          </Fragment>)}
        </nav>
        {secondaryNav.length>0&&<details className="demo-navigation" key={view==="telegram"?"active-demo":"demo"} open={view==="telegram"||undefined}><summary>Другие разделы</summary><div>{secondaryNav.map(item=><Fragment key={item.id}>{navControl(item)}</Fragment>)}</div></details>}
        {user.role==="doctor"&&<div className="availability-select sidebar-availability" aria-busy={availabilityBusy}>
          <div className="availability-heading"><label htmlFor={availabilityId}>Доступность врача</label><span role="status">{availabilityBusy?"Сохраняем…":""}</span></div>
          <div className="availability-field"><span className={`availability-dot ${availabilityBusy?"pending":user.availability==="available"?"online":""}`} aria-hidden="true"/>
            <select id={availabilityId} ref={availabilityFocus.ref} value={availabilityPending?.doctorId===user.id?availabilityPending.value:user.availability} disabled={availabilityBusy} aria-invalid={availabilityError?.doctorId===user.id||undefined} aria-describedby={availabilityError?.doctorId===user.id?`${availabilityId}-error`:undefined} onChange={event=>changeAvailability(event.target.value)}>
              {Object.entries(availability).map(([value,title])=><option key={value} value={value}>{title}</option>)}
            </select>
          </div>
          {availabilityError?.doctorId===user.id&&<p id={`${availabilityId}-error`} className="availability-error" role="alert">Изменение не подтверждено. {availabilityError.message} Выберите статус ещё раз, чтобы повторить.</p>}
        </div>}
        <div className="sidebar-profile">
          <Avatar name={accountName(user.display_name)} small />
          <div>
            <strong>{accountName(user.display_name)}</strong>
            <small>
              {user.role === "doctor"
                ? "Врач"
                : user.role === "patient"
                  ? "Пациент"
                  : user.role === "coordinator" ? "Координатор" : "Администратор"}
            </small>
            {user.scenario_label&&<small className="scenario-profile-label">Сценарий: {user.scenario_label}</small>}
          </div>
          <button className="icon-button" onClick={() => {setMenuOpen(false);guard.run(signOut);}} aria-label="Выйти">
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
          <span className="mobile-brand">{selectedPatient!==null?cardSections[patientEntry].title:selectedAssignment!==null?"Ответ на опрос":currentSection.title}</span>
          <nav className="breadcrumb" aria-label="Путь к странице">
            {navigationView!==defaultView(user.role)?<><button onClick={()=>navigate(defaultView(user.role))}>Главная</button><span aria-hidden="true">/</span></>:null}
            {selectedPatient!==null||selectedAssignment!==null?<><button onClick={()=>navigate(navigationView)}>{currentSection.title}</button><span aria-hidden="true">/</span><strong aria-current="page">{selectedPatient!==null?cardSections[patientEntry].title:"Ответ на опрос"}</strong></>:<strong aria-current="page">{currentSection.title}</strong>}
          </nav>
          <div className="topbar-actions">
            <button type="button" className="icon-button account-settings-trigger" aria-label="Настройки аккаунта" onClick={()=>{setMenuOpen(false);setSettingsOpen(true);}}><Settings2 size={19}/></button>
            {user.role === "doctor" && <DoctorInboxNotice key={user.id} open={() => navigate("events")} />}
            <Button variant="ghost" className="section-help-button" aria-label="Помощь с разделом" onClick={()=>setGuideStart(value=>value+1)}><CircleHelp size={18}/><span>Помощь</span></Button>

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
          <RoleGuide key={user.id} user={user} view={navigationView} navigate={navigate} startSignal={guideStart} context={user.role==="patient"&&selectedAssignment!==null?patientSurveyGuide:user.role==="doctor"&&selectedPatient!==null?cardSections[patientEntry]:undefined}/>
          <div key={`${view}-${navigationRevision}`} className="content-frame route-frame" style={{
            "--route-duration":`${transition.duration}s`,
            "--route-distance":`${moving?motionTokens.distance.small:0}px`,
            "--route-ease":`cubic-bezier(${motionTokens.easing.smooth.join(",")})`,
          } as CSSProperties}>
          <div className="route-page" data-page-location={routeHref(locationSnapshot.current?.route??pageRoute(user.role,view))}>
          <SectionBoundary key={`${user.id}-${view}`} refresh={()=>guard.run(()=>window.location.reload())}>
          <Suspense fallback={<div className="route-loading"><Loading/></div>}>
          {user.role === "doctor" ? (
            view === "home" ? <WorkspaceHome navigate={navigate}/> : view === "overview" ? (
              <DoctorDashboard
                openPatient={(id,key,answerTarget)=>openPatient(id,{returnKey:key,answerTarget})}
                createSurvey={() => navigate("surveys",()=>setNewSurvey(true))}
                openClinicalHistory={() => navigate("state")}
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
                onSelect={(id,entry)=>id===null?returnFromPatient():openPatient(id,{entry})}
                back={returnFromPatient}
                backLabel={patientOrigin?.label}
                scope={view}
                initialAnswer={patientAnswer??undefined}
                notify={notify}
                simulated={view === "telegram"}
                initialTab={patientEntry}
                onTabChange={changePatientTab}
                openClinicalLibrary={()=>navigate("surveys")}
                openTasks={() => navigate("tasks")}
              />
            )
          ) : user.role === "patient" ? (
            <PatientHome key={view} user={user} view={view} notify={notify} navigate={navigate} assignmentId={selectedAssignment} selectAssignment={selectAssignment}/>
          ) : user.role === "coordinator" ? (
            view==="urgent"?<CoordinatorNotices/>:<><div className="coordination-shortcut"><Button variant="secondary" onClick={()=>navigate("urgent")}>Срочные уведомления <ArrowRight size={17}/></Button></div><TaskBoard operational notify={notify}/></>
          ) : (
            <AdminDashboard view={view} navigate={navigate}/>
          )}
          </Suspense>
          </SectionBoundary>
          </div>
          </div>
        </main>
        <footer className="app-footer">
          {productName}
        </footer>
        {quickNav.length>0&&<nav className="mobile-navigation" aria-label="Быстрые переходы">
          {quickNav.map(([id,label])=>{
            const item=sectionFor(user.role,id),Icon=navIcons[item.icon];
            return <a key={id} href={routeHref(pageRoute(user.role,id))} aria-label={item.title} aria-current={navigationView===id?"page":undefined} className={navigationView===id?"active":""} onClick={event=>{if(!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey&&event.button===0){event.preventDefault();navigate(id);}}}><Icon size={20}/><span>{label}</span></a>;
          })}
          {user.role!=="admin"&&<button type="button" className={!quickNav.some(([id])=>id===navigationView)?"active":""} aria-label="Все разделы кабинета" aria-expanded={menuOpen} onClick={()=>setMenuOpen(true)}><Menu size={20}/><span>Ещё</span></button>}
        </nav>}
      </div>
      {settingsOpen&&<AccountSettings user={user} close={()=>setSettingsOpen(false)}/>}
    </div></ViewStateProvider>
  );
}

export default function App() {
  return <TelegramHost><NavigationGuard><Workspace/></NavigationGuard></TelegramHost>;
}
