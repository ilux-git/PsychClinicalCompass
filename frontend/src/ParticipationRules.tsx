import {ArrowRight,BookOpen,ClipboardList,Pill} from "lucide-react";
import {Button} from "./UI";
import type {PointsRule} from "./patientProgress";
import "./participation-rules.css";

const actions={
  survey:{view:"surveys",title:"Опросы",label:"К моим опросам",icon:ClipboardList},
  medication:{view:"medications",title:"Отметки о лекарствах",label:"Открыть расписание",icon:Pill},
  diary:{view:"diary",title:"Дневник состояния",label:"Открыть дневник",icon:BookOpen},
};

export function ParticipationRules({rules,navigate}:{rules:PointsRule[];navigate?:(view:string)=>void}) {
  return <ul className="participation-rule-list">{rules.map(rule=>{
    const action=actions[rule.kind as keyof typeof actions],Icon=action?.icon??ClipboardList;
    return <li className="participation-rule-card" key={rule.kind}>
      <div className="participation-rule-heading"><span aria-hidden="true"><Icon size={21}/></span><h3>{action?.title??rule.label}</h3></div>
      <div className="participation-rule-meta"><span><strong>{rule.earned_today}</strong> из {rule.daily_cap} баллов сегодня</span>
        {navigate&&action&&<Button variant="ghost" onClick={()=>navigate(action.view)}>{action.label}<ArrowRight size={15}/></Button>}
      </div>
    </li>;
  })}</ul>;
}
