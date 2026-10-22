import type { Assessment } from "./api";
import { Badge, date, Empty } from "./UI";

export function AssessmentHistory({ rows }: { rows: Assessment[] }) {
  if (!rows.length)
    return <Empty title="Измерений пока нет">Отсутствие ответов не означает нулевой балл.</Empty>;
  return (
    <div className="assessment-history">
      <p className="field-hint">
        Сохранённые числовые ответы. Разные шкалы и версии сравниваются отдельно.
        Изменение балла само по себе не устанавливает диагноз или эффект лечения.
      </p>
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
                    <Badge>{version === "demo_numeric_v1" ? "Синтетические ответы" : `Версия ${version}`}</Badge>
                    <span className="field-hint">Измерений: {points.length}</span>
                  </div>
                  <p className="assessment-change">
                    Последний результат: <strong>{last.score} / {maximum}</strong>
                    {comparable ? (
                      <> · изменение от первого: <strong>{change > 0 ? "+" : ""}{change} балл.</strong></>
                    ) : " · для сравнения нужны измерения в разные моменты времени"}
                  </p>
                  <div className="scale-points" aria-label={`История ${form.toUpperCase()}`}>
                    {points.map((row) => (
                      <div key={row.id}>
                        <span className="scale-point-bar" aria-hidden="true">
                          <i style={{ height: `${100 * row.score / maximum}%` }} />
                        </span>
                        <strong>{row.score}</strong>
                        <small>{new Date(row.created_at).toLocaleDateString("ru-RU")}</small>
                      </div>
                    ))}
                  </div>
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
      <p className="field-hint">
        Показаны номера пунктов и сохранённые значения. Тексты клинических форм
        и их интерпретация ожидают согласования; числовая история не заменяет разговор с врачом.
      </p>
    </div>
  );
}
