import type { Assessment } from "./api";
import { Badge, date } from "./UI";
import { TimeSeries } from "./Charts";

export function AssessmentHistory({ rows }: { rows: Assessment[] }) {
  if (!rows.length)return null;
  return (
    <div className="assessment-history">
      <h3>Числовая история состояния</h3><p className="field-hint">Эти исторические записи не получены из новых клинических бланков. Их динамика показана отдельно.</p>
      {["phq9", "gad7"].map((form) => {
        const versions = [...new Set(rows.filter((r) => r.form_type === form).map((r) => r.form_version))];
        return (
          <section className="assessment-form" key={form}>
            <h3>{form === "phq9" ? "PHQ-9" : "GAD-7"}</h3>
            {!versions.length && <p className="muted">Нет измерений этой шкалы.</p>}
            {versions.map((version) => {
              const points = rows.filter((r) => r.form_type === form && r.form_version === version)
                .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id - b.id);
              const first = points[0];
              const last = points[points.length - 1];
              const comparable = points.length > 1 && Date.parse(last.created_at) > Date.parse(first.created_at);
              const change = last.score - first.score;
              const maximum = form === "phq9" ? 27 : 21;
              return (
                <div key={version} className="assessment-version">
                  <div className="section-heading">
                    <Badge>{version === "demo_numeric_v1" ? "Числовая версия" : `Версия ${version}`}</Badge>
                    <span className="field-hint">Измерений: {points.length}</span>
                  </div>
                  <p className="assessment-change">
                    Последний результат: <strong>{last.score} / {maximum}</strong>
                    {comparable ? (
                      <> · изменение от первого: <strong>{change > 0 ? "+" : ""}{change} балл.</strong></>
                    ) : " · для сравнения нужны измерения в разные моменты времени"}
                  </p>
                  <TimeSeries title={`${form === "phq9" ? "PHQ-9" : "GAD-7"} · история наблюдений`} maximum={maximum} points={points.map(p => ({id:p.id, at:p.created_at, value:p.score}))}/>
                  {points.map((row) => (
                    <details className="assessment-answers" key={row.id}>
                      <summary>{date(row.created_at)} · {row.score} балл. · Ответы по пунктам</summary>
                      <ol>
                        {row.answers.map((answer, index) => (
                          <li key={index}><span>Пункт {index + 1}</span><strong>{answer} / 3</strong></li>
                        ))}
                      </ol>
                    </details>
                  ))}
                </div>
              );
            })}
          </section>
        );
      })}
      <details className="source-help"><summary>Об истории измерений</summary><p>Сравниваются измерения одной шкалы и версии. Балл сам по себе не устанавливает диагноз и не доказывает эффект лечения. Источник и формулировки новых клинических бланков указаны отдельно, рядом с их результатами.</p></details>
    </div>
  );
}
