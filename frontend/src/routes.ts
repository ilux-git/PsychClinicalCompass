import { defaultView, navigationFor, type CardTab } from "./navigation.ts";
import { applicationBase } from "./telegramRuntime.ts";

export type WorkspaceRoute={view:string;patientId:number|null;cardTab:CardTab;assignmentId:number|null};
export type RouteContext={origin?:{view:string;key:string};answer?:{assignmentId:number;submissionId:number;questionId:string};returnPoint?:{scope:string;key:string}};
const cardTabs:CardTab[]=["feedback","care","events","medications","chat","clinical"];
const positiveId=(value:string|null)=>value&&/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value))?Number(value):null;

export function readRoute(role:string,href:string):WorkspaceRoute {
  const params=new URL(href,"http://compass.local").searchParams;
  const requested=params.get("section")??defaultView(role);
  const view=navigationFor(role).some(item=>item.id===requested)?requested:defaultView(role);
  const patientId=role==="doctor"&&["patients","state","telegram"].includes(view)?positiveId(params.get("patient")):null;
  const requestedTab=params.get("tab") as CardTab;
  const cardTab=patientId&&cardTabs.includes(requestedTab)?requestedTab:view==="state"?"clinical":view==="telegram"?"chat":"feedback";
  const assignmentId=role==="patient"&&["overview","surveys"].includes(view)?positiveId(params.get("assignment")):null;
  return {view,patientId,cardTab,assignmentId};
}
export function routeHref(route:WorkspaceRoute,basePath="/") {
  const params=new URLSearchParams({section:route.view});
  if(route.patientId!==null){params.set("patient",String(route.patientId));params.set("tab",route.cardTab);}
  if(route.assignmentId!==null)params.set("assignment",String(route.assignmentId));
  return `${basePath==="/tg"?"/tg":"/"}?${params}`;
}
export function pageRoute(role:string,view:string) {return readRoute(role,`/?section=${encodeURIComponent(view)}`);}

type HistoryEntry={owner:number;index:number;context:RouteContext};
export type LocationPort={href:()=>string;state:()=>unknown;push:(state:unknown,href:string)=>void;replace:(state:unknown,href:string)=>void;go:(delta:number)=>void;listen:(callback:()=>void)=>()=>void};

/** Compensate a native traversal before asking about drafts; cancel keeps both URL and form. */
export function createWorkspaceHistory({role,owner,port,approve,apply}:{role:string;owner:number;port:LocationPort;approve:(action:()=>void,target:WorkspaceRoute)=>void;apply:(route:WorkspaceRoute,context:RouteContext)=>void}) {
  const basePath=applicationBase(new URL(port.href(),"http://compass.local").pathname);
  const href=(route:WorkspaceRoute)=>routeHref(route,basePath);
  function cleanContext(value:RouteContext|undefined):RouteContext {
    if(!value||typeof value!=="object")return {};
    const known=(view:unknown)=>typeof view==="string"&&navigationFor(role).some(item=>item.id===view);
    const key=(value:unknown)=>typeof value==="string"&&value.length<=250;
    const id=(value:unknown)=>typeof value==="number"&&Number.isSafeInteger(value)&&value>0;
    const context:RouteContext={};
    if(value.origin&&known(value.origin.view)&&key(value.origin.key))context.origin={view:value.origin.view,key:value.origin.key};
    if(value.returnPoint&&known(value.returnPoint.scope)&&key(value.returnPoint.key))context.returnPoint={scope:value.returnPoint.scope,key:value.returnPoint.key};
    if(role==="doctor"&&value.answer&&id(value.answer.assignmentId)&&id(value.answer.submissionId)&&key(value.answer.questionId))context.answer={assignmentId:value.answer.assignmentId,submissionId:value.answer.submissionId,questionId:value.answer.questionId};
    return context;
  }
  function entry(value:unknown):HistoryEntry|null {
    if(!value||typeof value!=="object")return null;
    const candidate=(value as {compassNavigation?:HistoryEntry}).compassNavigation;
    return candidate?.owner===owner&&Number.isSafeInteger(candidate.index)&&candidate.index>=0?{owner,index:candidate.index,context:cleanContext(candidate.context)}:null;
  }
  const prior=entry(port.state());
  const foreign=Boolean(port.state()&&typeof port.state()==="object"&&"compassNavigation" in (port.state() as object)&&!prior);
  let current={route:readRoute(role,foreign?href(pageRoute(role,defaultView(role))):port.href()),entry:prior??{owner,index:0,context:{}}};
  let restoring:{route:WorkspaceRoute;entry:HistoryEntry}|null=null;
  let replaying=false,disposed=false;
  const state=(value:HistoryEntry)=>({compassNavigation:value});
  function render(next:typeof current) {current=next;apply(next.route,next.entry.context);}
  port.replace(state(current.entry),href(current.route));
  apply(current.route,current.entry.context);
  const stop=port.listen(()=>{
    if(disposed)return;
    const nextEntry=entry(port.state());
    const nextRoute=readRoute(role,port.href());
    if(restoring){
      const target=restoring;restoring=null;
      approve(()=>{if(disposed)return;replaying=true;port.go(target.entry.index-current.entry.index);},target.route);
      return;
    }
    if(replaying){replaying=false;if(nextEntry)render({route:nextRoute,entry:nextEntry});return;}
    if(nextEntry&&nextEntry.index!==current.entry.index){
      restoring={route:nextRoute,entry:nextEntry};
      port.go(current.entry.index-nextEntry.index);
      return;
    }
    if(nextEntry&&href(nextRoute)===href(current.route))return;
    // A same-document entry from outside this workspace has no trustworthy traversal index.
    port.replace(state(current.entry),href(current.route));
    const safeTarget=nextEntry?nextRoute:pageRoute(role,defaultView(role));
    approve(()=>{if(disposed)return;const next={route:safeTarget,entry:{...current.entry,context:{}}};port.replace(state(next.entry),href(next.route));render(next);},safeTarget);
  });
  return {
    push(route:WorkspaceRoute,context:RouteContext={}) {
      if(disposed||restoring||replaying)return;
      const normalized=readRoute(role,href(route));
      if(href(normalized)===href(current.route)&&JSON.stringify(context)===JSON.stringify(current.entry.context))return;
      const next={route:normalized,entry:{owner,index:current.entry.index+1,context:cleanContext(context)}};
      port.push(state(next.entry),href(normalized));render(next);
    },
    current:()=>current,
    dispose(){disposed=true;stop();},
  };
}
