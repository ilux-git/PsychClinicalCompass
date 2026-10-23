import type { Question } from "./api";

export function SurveyFields({
  questions,
  answers,
  onChange,
  disabled = false,
}: {
  questions: Question[];
  answers: Record<string, unknown>;
  onChange: (answers: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
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
        <fieldset key={q.id} disabled={disabled} className="survey-question">
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
          {q.kind === "multiple" && (
            <p className="field-hint">Можно выбрать несколько вариантов</p>
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
}: {
  questions: Question[];
  answers: Record<string, unknown>;
}) {
  return (
    <dl className="answer-summary">
      {questions.map((q) => {
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
          <div key={q.id}>
            <dt>{q.prompt}</dt>
            <dd>{answer}</dd>
          </div>
        );
      })}
    </dl>
  );
}
