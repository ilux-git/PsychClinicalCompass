import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiError, send, useApi, type ClinicalResult } from "./api";
import { Button, ErrorBox, Loading } from "./UI";
import { clinicalDate } from "./ClinicalReview";
import { useUnsavedForm } from "./NavigationGuard";

type Baseline={result_id:number|null;revision:number;selected_at:string|null;reason:string};

export function ClinicalBaseline({patientId,instrumentKey,rows,scope}: {patientId:number;instrumentKey:string;rows:ClinicalResult[];scope?:string}) {
  const path=`/patients/${patientId}/clinical-baselines/${instrumentKey}`;
  const baseline=useApi<Baseline>(path);
  const [selection,setSelection]=useState<string|null>(null),[reason,setReason]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[saved,setSaved]=useState("");
  const [conflictRevision,setConflictRevision]=useState<number|null>(null);
  const form=useRef<HTMLFormElement>(null),status=useRef<HTMLParagraphElement>(null);
  const dirty=selection!==null||Boolean(reason);
  const {clear}=useUnsavedForm({dirty,pending:busy,scope,focus:()=>form.current?.querySelector<HTMLElement>('.error-box,select')?.focus()});
  useEffect(()=>{if(error)form.current?.querySelector<HTMLElement>('.error-box')?.focus();},[error]);
  useEffect(()=>{if(saved)status.current?.focus({preventScroll:true});},[saved]);
  useEffect(()=>{if(conflictRevision!==null&&baseline.data&&baseline.data.revision!==conflictRevision){setConflictRevision(null);setError("");}},[baseline.data,conflictRevision]);
  async function save(event:FormEvent) {
    event.preventDefault();if(busy||!baseline.data||conflictRevision!==null)return;
    setBusy(true);setError("");setSaved("");
    try {
      const value=selection??(baseline.data.result_id===null?"":String(baseline.data.result_id));
      await send(path,{result_id:value===""?null:Number(value),expected_revision:baseline.data.revision,reason},"PUT");
      setSelection(null);setReason("");clear();baseline.reload();
      setSaved("Исходное измерение сохранено для следующих сравнений. История результатов не изменена.");
    } catch(failure) {
      setError(failure instanceof Error?failure.message:"Не удалось сохранить исходное измерение");
      if(failure instanceof ApiError&&failure.status===409)setConflictRevision(baseline.data.revision);
    } finally {setBusy(false);}
  }
  return <details className="clinical-baseline"><summary>Исходное измерение PHQ-9</summary>
    <p className="field-hint">Выберите результат, с которым следует сравнивать следующие измерения этой версии. Выбор не пересчитывает прежние события. Основание выбора доступно только врачу.</p>
    <ErrorBox message={baseline.error} retry={baseline.reload}/>
    {!baseline.data?<Loading/>:<form ref={form} onSubmit={save} aria-busy={busy}>
      <p className="field-hint">{baseline.data.result_id===null?"Исходное измерение пока не выбрано.":`Текущий выбор сохранён ${clinicalDate(baseline.data.selected_at)}. Основание: ${baseline.data.reason}`}</p>
      <label className="field">Измерение для следующих сравнений<select disabled={busy||Boolean(baseline.error)} value={selection??(baseline.data.result_id===null?"":String(baseline.data.result_id))} onChange={event=>{setSelection(event.target.value);setSaved("");}}>
        <option value="">Исходное не задано</option>{rows.map(row=><option key={row.id} value={row.id}>{clinicalDate(row.created_at)} · {row.score} балл.</option>)}
      </select></label>
      <label className="field">Основание выбора<textarea value={reason} required maxLength={500} rows={2} disabled={busy} onChange={event=>{setReason(event.target.value);setSaved("");}} placeholder="Например, измерение перед началом согласованного курса"/></label>
      <ErrorBox message={error}/>
      {conflictRevision!==null&&<Button type="button" variant="secondary" onClick={baseline.reload}>Обновить выбор врача</Button>}
      <div className="button-row"><Button type="submit" aria-disabled={busy||conflictRevision!==null||!reason.trim()||Boolean(baseline.error)} disabled={conflictRevision!==null||!reason.trim()||Boolean(baseline.error)}>{busy?"Сохраняем…":"Сохранить исходное измерение"}</Button>
        <Button type="button" variant="secondary" disabled={busy||!dirty} onClick={()=>{setSelection(null);setReason("");setError("");clear();}}>Отменить изменения</Button></div>
      {saved&&<p ref={status} role="status" tabIndex={-1}>{saved}</p>}
    </form>}
  </details>;
}
