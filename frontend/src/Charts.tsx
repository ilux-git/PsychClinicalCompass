import { useEffect, useId, useRef, useState } from "react";
import { plural } from "./UI";

export function CoverageGrid({rows}: {rows:{label:string;responded:number|null;assigned:number|null;percent:number|null;note?:string}[]}) {
  return <div className="coverage-grid">{rows.map(row=><article className="coverage-cell" key={row.label}>
    <h3>{row.label}</h3><div className="coverage-value"><strong>{row.responded === null ? "Скрыто" : row.responded}</strong>{row.assigned !== null&&<span>из {row.assigned}</span>}</div>
    <div className={`coverage-track ${row.percent === null?"unknown":""}`} aria-hidden="true">{row.percent !== null&&<i style={{width:`${Math.max(0,Math.min(100,row.percent))}%`}}/>}</div>
    <p>{row.percent === null?row.responded === null?"Защищено правилами групп":"Нет назначенных вопросов":`${row.percent}% ответили на вопросы`}</p>
    {row.note&&<small>{row.note}</small>}
  </article>)}</div>;
}

function countUnit(value:number, unit:string) {
  const forms:Record<string,[string,string,string]> = {
    "баллов":["балл","балла","баллов"],"опросов":["опрос","опроса","опросов"],
    "ответов":["ответ","ответа","ответов"],"пациентов":["пациент","пациента","пациентов"],
    "задач":["задача","задачи","задач"],"самоотчётов":["самоотчёт","самоотчёта","самоотчётов"],
    "обращений":["обращение","обращения","обращений"],
  };
  return forms[unit] ? plural(value,...forms[unit]) : unit;
}

export function HorizontalBars({title, rows, unit = "", maximum, caption}: {
  title: string; rows: {label: string; value: number | null}[]; unit?: string; maximum?: number; caption?: string;
}) {
  const scale = Math.max(1,maximum??0,...rows.map(row=>row.value??0));
  return <figure className="metric-chart" aria-label={title}>
    <figcaption>{title}</figcaption>
    {!rows.length ? <p className="muted">Подходящих наблюдений пока нет.</p> : <div className="chart-bars">{rows.map((row,i) => <div className="chart-bar-row" key={`${row.label}-${i}`}>
      <div><span>{row.label}</span><strong>{row.value === null ? "Нет данных" : `${row.value.toLocaleString("ru-RU")}${unit ? ` ${countUnit(row.value,unit)}` : ""}`}</strong></div>
      <div className={`chart-bar-track ${row.value === null ? "unmeasured" : ""}`} aria-hidden="true"><i style={{width:`${Math.min(100, Math.max(0, (row.value ?? 0)/scale*100))}%`}}/></div>
    </div>)}</div>}
    {!!rows.length&&<div className="chart-count-axis" aria-hidden="true"><span>0</span><span>{scale.toLocaleString("ru-RU")}{unit?` ${countUnit(scale,unit)}`:""}</span></div>}
    {caption && <p className="field-hint">{caption}</p>}
  </figure>;
}

export function TimeSeries({title, points, maximum, unit = "балл."}: {
  title: string; points: {id: number; at: string; value: number}[]; maximum: number; unit?: string;
}) {
  const identifier = useId().replace(/:/g, "");
  const container = useRef<HTMLDivElement>(null);
  const [width,setWidth] = useState(660);
  const sorted = [...points].filter(p => Number.isFinite(Date.parse(p.at))).sort((a,b) => Date.parse(a.at)-Date.parse(b.at) || a.id-b.id);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240,Math.round(entry.contentRect.width))));
    observer.observe(container.current);
    return () => observer.disconnect();
  },[sorted.length>0]);
  if (!sorted.length) return <p className="muted">Нет наблюдений для графика.</p>;
  const first = Date.parse(sorted[0].at), last = Date.parse(sorted.at(-1)!.at);
  const x = (at: string) => last === first ? 44 : 44+(Date.parse(at)-first)/(last-first)*(width-66);
  const y = (value: number) => 194-Math.max(0, Math.min(maximum, value))/maximum*160;
  const path = sorted.map((p,i) => `${i ? "L" : "M"}${x(p.at)},${y(p.value)}`).join(" ");
  const tickPoints = first === last ? [sorted[0]] : [...new Set(width<420 ? [0,sorted.length-1] : [0,Math.floor((sorted.length-1)/2),sorted.length-1])].map(i => sorted[i]);
  return <figure className="metric-chart time-series" aria-label={title}>
    <figcaption>{title}</figcaption>
    <div className="time-series-plot" ref={container}>
    <svg viewBox={`0 0 ${width} 244`} role="img" aria-label={`${title}. ${sorted.length} ${plural(sorted.length,"наблюдение","наблюдения","наблюдений")}. Последнее: ${sorted.at(-1)!.value} ${unit}`}>
      <defs><linearGradient id={identifier} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3e897e" stopOpacity=".16"/><stop offset="100%" stopColor="#3e897e" stopOpacity="0"/></linearGradient></defs>
      {[0,1,2,3].map(i => {const value = maximum*i/3; return <g key={i}><line x1="44" x2={width-22} y1={y(value)} y2={y(value)} stroke="#e9e6ef"/><text x="32" y={y(value)+4} textAnchor="end" className="chart-axis">{Number(value.toFixed(1))}</text></g>;})}
      <text x="44" y="18" className="chart-axis">{unit}</text>
      {sorted.length > 1 && last > first && <><path d={`${path} L${x(sorted.at(-1)!.at)},194 L${x(sorted[0].at)},194 Z`} fill={`url(#${identifier})`}/><path d={path} fill="none" stroke="#317c74" strokeWidth="2.5" strokeLinejoin="round"/></>}
      {sorted.map(p => <circle key={p.id} cx={x(p.at)} cy={y(p.value)} r="4.5" fill="#317c74" stroke="white" strokeWidth="2"><title>{new Date(p.at).toLocaleString("ru-RU")}: {p.value} {unit}</title></circle>)}
      {tickPoints.map((p,i) => <text key={p.id} x={x(p.at)} y="222" textAnchor={i===0 ? "start" : i===tickPoints.length-1 ? "end" : "middle"} className="chart-axis">{new Date(p.at).toLocaleDateString("ru-RU",{day:"numeric",month:"short"})}</text>)}
    </svg>
    </div>
    <p className="field-hint">{first === last ? "Измерения в один момент времени; динамику оценить нельзя." : "Точки расположены по фактическим датам. Между точками новых измерений нет."}</p>
  </figure>;
}
