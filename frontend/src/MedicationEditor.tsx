import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { send } from "./api";
import { Button, ErrorBox, Section, type Notify } from "./UI";
import { useUnsavedForm, type LeavePrompt } from "./NavigationGuard";
import type { MedicationItem } from "./MedicationSchedule";
import type { ParticipationConfirmation } from "./ParticipationReceipt";

const editorPrompt:LeavePrompt={eyebrow:"Личное расписание",title:"Продолжить редактирование расписания?",message:"Изменения личной позиции ещё не сохранены. При переходе без сохранения текущий ввод будет потерян. Назначения МИС не меняются.",stayLabel:"Продолжить редактирование"};
const week=["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];
export function localDay() {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;}

export function MedicationEditor({item,scope,notify,onSaved,onClose,onSaving}:{item:MedicationItem|null;scope:string;notify:Notify;onSaved:(result:ParticipationConfirmation)=>void;onClose:()=>void;onSaving:()=>void}) {
  const [fields,setFields]=useState(()=>({
    label:item?.label??"",instructions:item?.instructions??"",text:item?.schedule_text??"",
    kind:item?.schedule_kind??"fixed",times:item?.times.join(", ")??"",
    weekdays:item?.weekdays??[0,1,2,3,4,5,6],
    zone:item?.timezone??(Intl.DateTimeFormat().resolvedOptions().timeZone||"UTC"),
    start:item?.starts_on??localDay(),end:item?.ends_on??"",active:item?.active??true,
  }));
  const baseline=useRef(JSON.stringify(fields));
  const [busy,setBusy]=useState(false);
  const [saveError,setSaveError]=useState("");
  const errorResult=useRef<HTMLDivElement>(null),errorId=useId();
  const request=useRef({signature:"",id:""});
  const name=useRef<HTMLInputElement>(null);
  const {clear,confirm}=useUnsavedForm({dirty:JSON.stringify(fields)!==baseline.current,pending:busy,prompt:editorPrompt,scope,focus:()=>name.current?.focus()});
  useEffect(()=>{name.current?.focus();},[]);
  useEffect(()=>{if(saveError)errorResult.current?.querySelector<HTMLElement>('.error-box')?.focus();},[saveError]);
  function patch(value:Partial<typeof fields>) {setSaveError("");setFields(current=>({...current,...value}));}
  async function save(event:FormEvent) {
    event.preventDefault();if(busy)return;
    const data={label:fields.label,instructions:fields.instructions,schedule_text:fields.text,schedule_kind:fields.kind,
      times:fields.kind==="fixed"?fields.times.split(",").map(value=>value.trim()).filter(Boolean):[],
      weekdays:fields.kind==="fixed"?fields.weekdays:[],timezone:fields.zone,starts_on:fields.start,ends_on:fields.end||null,active:fields.active};
    const signature=JSON.stringify(data);
    if(request.current.signature!==signature)request.current={signature,id:crypto.randomUUID()};
    onSaving();setSaveError("");setBusy(true);
    try {
      const response=item?await send<ParticipationConfirmation>(`/medications/items/${item.id}`,{...data,expected_revision:item.revision},"PUT"):
        await send<ParticipationConfirmation>("/medications/items",{...data,client_request_id:request.current.id});
      clear();notify("Личная позиция сохранена; назначение МИС не менялось");onSaved(response);
    } catch(error) {setSaveError(error instanceof Error?error.message:"Не удалось сохранить расписание");}
    finally {setBusy(false);}
  }
  return <Section title={item?"Изменить личную позицию":"Добавить свою позицию"} className="medication-editor">
    <p className="field-hint">Запишите согласованное с врачом расписание или свой способ учёта. Это личная запись, она не меняет назначение в МИС.</p>
    <form onSubmit={save}><div ref={errorResult} id={errorId}><ErrorBox message={saveError}/></div><fieldset className="form-fields" disabled={busy} aria-busy={busy} aria-describedby={saveError?errorId:undefined}>
      <label className="field">Название<input ref={name} required maxLength={300} value={fields.label} onChange={e=>patch({label:e.target.value})}/></label>
      <label className="field">Своё описание / инструкция · необязательно<textarea maxLength={2000} value={fields.instructions} onChange={e=>patch({instructions:e.target.value})}/></label>
      <label className="field">Расписание своими словами<textarea required maxLength={1500} value={fields.text} onChange={e=>patch({text:e.target.value})}/></label>
      <label className="field">Тип учёта<select value={fields.kind} onChange={e=>patch({kind:e.target.value})}><option value="fixed">Дни недели и фиксированное время</option><option value="as_needed">По потребности · описание</option><option value="description">Произвольное расписание · описание</option></select></label>
      {fields.kind==="fixed"&&<>
        <label className="field">Время<input required value={fields.times} onChange={e=>patch({times:e.target.value})} placeholder="08:30, 20:00" aria-describedby="medication-times-hint"/><small id="medication-times-hint">24-часовой формат. Несколько времён разделяйте запятой.</small></label>
        <fieldset className="weekdays"><legend>Дни недели</legend>{week.map((label,index)=><label key={label}><input type="checkbox" checked={fields.weekdays.includes(index)} onChange={()=>patch({weekdays:fields.weekdays.includes(index)?fields.weekdays.filter(day=>day!==index):[...fields.weekdays,index]})}/>{label}</label>)}</fieldset>
      </>}
      <div className="form-grid"><label className="field">С даты<input type="date" required value={fields.start} onChange={e=>patch({start:e.target.value})}/></label><label className="field">По дату · необязательно<input type="date" min={fields.start} value={fields.end} onChange={e=>patch({end:e.target.value})}/></label></div>
      <label className="field">Часовой пояс<input required value={fields.zone} onChange={e=>patch({zone:e.target.value})}/><small>Определён по устройству. Например, Asia/Novosibirsk. Время расписания считается в этом поясе.</small></label>
      <label className="checkbox-label"><input type="checkbox" checked={fields.active} onChange={e=>patch({active:e.target.checked})}/>Активная личная позиция</label>
      <div className="button-row"><Button type="submit" disabled={busy}>{busy?"Сохраняем…":"Сохранить личное расписание"}</Button><Button type="button" variant="ghost" disabled={busy} onClick={()=>confirm(onClose)}>Отменить</Button></div>
    </fieldset></form>
  </Section>;
}
