// Display labels only. Sources and limits: docs/UI_LABEL_SOURCES_2026-10-25.md.
// No diagnosis, dosing, registration status or treatment suitability is inferred.
const depressionSource = "https://apicr.minzdrav.gov.ru/api.ashx?id=301_3&op=GetClinrecPdf";
const anxietySource = "https://apicr.minzdrav.gov.ru/api.ashx?id=457_3&op=GetClinrecPdf";

const diagnoses: Record<string, {name:string; source:string; reference:string}> = {
  "F32.1": {name:"Депрессивный эпизод средней степени",source:depressionSource,reference:"КР 301_3 · раздел 1.4"},
  "F41.1": {name:"Генерализованное тревожное расстройство",source:anxietySource,reference:"КР 457_3 · раздел 1.4"},
};

export function diagnosisLabel(raw:string) {
  return diagnoses[raw.trim().toUpperCase()] ?? null;
}

const names:Record<string,string> = {
  sertraline:"Сертралин",escitalopram:"Эсциталопрам",fluoxetine:"Флуоксетин",
  venlafaxine:"Венлафаксин",mirtazapine:"Миртазапин",duloxetine:"Дулоксетин",
  quetiapine:"Кветиапин",clonazepam:"Клоназепам",
};

/** Preserve personal text, unknown sources and any ambiguous or compound prescription. */
export function prescriptionLabel(raw:string, source:string) {
  if (source!=="MIS" && source!=="synthetic_mis_json") return raw;
  const match=raw.match(/^\s*([a-z]+)\s+(\d+(?:[.,]\d+)?)\s*mg\s*$/i);
  const key=match?.[1].toLowerCase();
  const name=key&&Object.hasOwn(names,key)?names[key]:undefined;
  return match&&name?`${name} ${match[2]} мг`:raw;
}
