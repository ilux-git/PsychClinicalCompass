import { useApi } from "./api";
import { Badge, ErrorBox, Loading, Section, date } from "./UI";

type Points = {balance: number; policy_version: string; next_reset_at: string;
  rules: {kind: string; label: string; daily_cap: number; description: string; earned_today: number}[];
  history: {id: number; kind: string; points: number; created_at: string}[]; principles: string[]};

export function ParticipationPoints() {
  const result = useApi<Points>("/participation/points", 10000);
  return <Section title="Баллы за участие">
    <ErrorBox message={result.error} retry={result.reload} />
    {result.loading ? <Loading /> : result.data && <>
      <div className="points-balance"><strong>{result.data.balance}</strong><span>баллов участия</span><Badge tone="purple">Демонстрационный тариф</Badge></div>
      <div className="collection-grid">{result.data.rules.map(rule => <article className="collection-card" key={rule.kind}><h3>{rule.label}</h3><p>{rule.description}</p><strong>{rule.earned_today} / {rule.daily_cap}</strong><small>Сегодня начислено / дневной предел</small></article>)}</div>
      <p className="field-hint">Лимит обновится {date(result.data.next_reset_at)}. После лимита можно продолжать записи; баллы не уменьшаются за пропущенные дни.</p>
      <details><summary>Условия и история начислений</summary>{result.data.principles.map(p => <p key={p}>{p}</p>)}
        {!result.data.history.length && <p>Начислений пока нет. Баллы появятся за новые действия.</p>}
        {result.data.history.map(row => <p key={row.id}>{date(row.created_at)} · {result.data!.rules.find(r => r.kind === row.kind)?.label} · {row.points ? `+${row.points}` : "Дневной предел уже достигнут"}</p>)}
      </details>
    </>}
  </Section>;
}
