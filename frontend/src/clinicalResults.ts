import type { ClinicalResult } from "./api";

const measuredAt=(row:ClinicalResult)=>Date.parse(row.created_at)||0;
const chronological=(a:ClinicalResult,b:ClinicalResult)=>measuredAt(a)-measuredAt(b)||a.id-b.id;

/** Keep editions separate; put the edition with the newest measurement first. */
export function clinicalEditions(results:ClinicalResult[]) {
  const editions=new Map<string,ClinicalResult[]>();
  for(const result of results) {
    const rows=editions.get(result.instrument_key)??[];
    rows.push(result);
    editions.set(result.instrument_key,rows);
  }
  return [...editions.values()].map(rows=>{
    rows.sort(chronological);
    return {key:rows[0].instrument_key,definition:rows[0].definition,rows,latest:rows[rows.length-1]};
  }).sort((a,b)=>chronological(b.latest,a.latest));
}

export function clinicalResultLabel(row:ClinicalResult) {
  if(row.result.kind==="panic_screen")return row.result.criterion_met===true?"Критерий скрининга выполнен":
    row.result.criterion_met===false?"Критерий скрининга не выполнен":"Критерий скрининга не определён";
  return row.score!==null&&row.definition.maximum!==null?`${row.score} / ${row.definition.maximum}`:"Результат не рассчитан";
}
