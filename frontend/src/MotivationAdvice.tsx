import { useState } from "react";
import { send, useApi } from "./api";
import { ErrorBox, Section, type Notify } from "./UI";
import { motivationModes as modes, type MotivationPreference } from "./patientProgress";

/** Kept separate so the physician workspace does not load the patient's game and coupon UI. */
export function MotivationAdvice({patientId,notify}: {patientId:number;notify:Notify}) {
  const pref = useApi<MotivationPreference>(`/patients/${patientId}/motivation`);
  const [busy,setBusy] = useState(false);
  async function recommend(mode:string) {
    setBusy(true);
    try {await send(`/patients/${patientId}/motivation`,{mode:mode || null},'PUT');pref.reload();notify("Рекомендация вида маршрута сохранена");}
    catch(error){notify(error instanceof Error?error.message:"Не удалось сохранить","error");}
    finally {setBusy(false);}
  }
  return <Section title="Поддержка участия"><ErrorBox message={pref.error} retry={pref.reload}/>{pref.data&&<><label className="field">Рекомендованный вид маршрута<select value={pref.data.doctor_recommendation??""} disabled={busy} onChange={event=>recommend(event.target.value)}><option value="">Без рекомендации</option>{Object.entries(modes).map(([key,label])=><option value={key} key={key}>{label}</option>)}</select></label><p className="field-hint">Пациент может выбрать спокойный вид или другой режим. Это настройка интерфейса, а не оценка психотипа. Баллы и доступ к помощи от выбора не зависят.</p><p>Сейчас у пациента: {modes[pref.data.effective_mode]}</p></>}</Section>;
}
