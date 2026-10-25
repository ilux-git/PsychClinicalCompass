import type { Question } from "./api";
import { useId } from "react";

export function SurveyFields({
  questions,
  answers,
  onChange,
  disabled = false,
  errors = {},
}: {
  questions: Question[];
  answers: Record<string, unknown>;
  onChange: (answers: Record<string, unknown>) => void;
  disabled?: boolean;
  errors?:Record<string,string>;
}) {
  const formId=useId();
  const change = (id: string, value: unknown) =>
    onChange({ ...answers, [id]: value });
  function choose(q: Question, option: Question["options"][number]) {
    if (q.kind === "single") return change(q.id, option.id);
    const previous = Array.isArray(answers[q.id]) ? answers[q.id] as string[] : [];
    change(q.id, previous.includes(option.id) ? previous.filter(x => x !== option.id) : option.exclusive ? [option.id] :
      [...previous.filter(x => !q.options.find(o => o.id === x)?.exclusive), option.id]);
  }
  return (
    <div className="survey-questions">
      {questions.map((q, index) => (
        <fieldset key={q.id} data-question={q.id} disabled={disabled} className="survey-question" aria-invalid={Boolean(errors[q.id])||undefined} aria-describedby={errors[q.id]?`${formId}-${index}-error`:undefined}>
          <legend>
            <span className="question-number">{index + 1}</span>
            {q.prompt}
            {q.required && (
              <span className="required-mark" aria-label="обязательный вопрос">
                {" "}
                *
              </span>
            )}
          </legend>
          {errors[q.id]&&<p className="question-error" role="alert" id={`${formId}-${index}-error`}>{errors[q.id]}</p>}
          {q.kind === "text" && (
            <textarea
              aria-label={q.prompt}
              required={q.required}
              maxLength={4000}
              rows={3}
              value={String(answers[q.id] ?? "")}
              onChange={(e) => change(q.id, e.target.value)}
              placeholder="Расскажите своими словами"
            />
          )}
          {q.kind === "scale" && (
            <div className="scale-answer">
              <input
                type="number"
                step={1}
                aria-label={q.prompt}
                required={q.required}
                min={q.minimum}
                max={q.maximum}
                value={answers[q.id] === undefined ? "" : String(answers[q.id])}
                onChange={(e) =>
                  change(
                    q.id,
                    e.target.value === "" ? undefined : Number(e.target.value),
                  )
                }
                placeholder={`${q.minimum}–${q.maximum}`}
              />
              <span className="muted">
                От {q.minimum} до {q.maximum}
              </span>
            </div>
          )}
          {q.kind === "multiple" && !errors[q.id] && (
            <p className="field-hint">{q.required ? "Выберите хотя бы один вариант. Можно несколько." : "Можно выбрать несколько вариантов"}</p>
          )}
          {(q.kind === "single" || q.kind === "multiple") && (
            <div className="choices">
              {q.options.map((option) => (
                <label
                  key={option.id}
                  className={`answer-option ${q.kind === "single" ? (answers[q.id] === option.id ? "checked" : "") : Array.isArray(answers[q.id]) && (answers[q.id] as string[]).includes(option.id) ? "checked" : ""}`}
                >
                  <input
                    type={q.kind === "single" ? "radio" : "checkbox"}
                    name={`answer-${q.id}`}
                    required={q.kind === "single" && q.required}
                    checked={
                      q.kind === "single"
                        ? answers[q.id] === option.id
                        : Array.isArray(answers[q.id]) &&
                          (answers[q.id] as string[]).includes(option.id)
                    }
                    onChange={() => choose(q, option)}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      ))}
    </div>
  );
}

export function AnswerSummary({
  questions,
  answers,
  highlightQuestion,
}: {
  questions: Question[];
  answers: Record<string, unknown>;
  highlightQuestion?:string;
}) {
  const summaryId=useId();
  return (
    <dl className="answer-summary">
      {questions.map((q,index) => {
        const value = answers[q.id];
        const label = (id: string) =>
          q.options.find((o) => o.id === id)?.label ?? id;
        const answer =
          value === undefined
            ? "Нет ответа"
            : Array.isArray(value)
              ? value.map((v) => label(String(v))).join(", ")
              : q.kind === "single"
                ? label(String(value))
                : String(value);
        return (
          <div key={q.id} data-question={q.id} className={highlightQuestion===q.id?"answer-highlight":undefined} tabIndex={highlightQuestion===q.id?-1:undefined} role={highlightQuestion===q.id?"group":undefined} aria-labelledby={highlightQuestion===q.id?`${summaryId}-${index}`:undefined}>
            <dt id={`${summaryId}-${index}`}>{q.prompt}</dt>
            <dd>{answer}{q.kind==="scale"&&typeof value==="number"&&<> <span className="answer-scale-range">Шкала от {q.minimum} до {q.maximum}</span></>}</dd>
          </div>
        );
      })}
    </dl>
  );
}
