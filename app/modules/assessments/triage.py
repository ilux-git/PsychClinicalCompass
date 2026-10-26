"""Physician-provided workflow rules, kept separate from an instrument's scoring key.

Source: Вопросы_ответы_26-10-2026.txt, direct user confirmations on 26.10.2026.
These rules organize human review; they do not diagnose or prescribe treatment.
"""
from app.modules.assessments.catalog import GAD7_KEY, PANIC_KEY, PHQ9_KEY

RULE_VERSION = "medical_answers_20261026_v1"


def comparison(score: int, reference: dict | None) -> dict:
    if reference is None:
        return {"result_id": None, "score": None, "created_at": None, "delta": None,
                "growth_criterion_met": None}
    delta = score - reference["score"]
    return {**reference, "delta": delta, "growth_criterion_met": delta >= 10}


def assess_review(key: str, score: int | None, result: dict, *,
                  previous: dict | None = None, baseline: dict | None = None) -> dict:
    review = {"rule_version": RULE_VERSION, "source": "medical_answers_2026-10-26",
              "severity": "no_signal", "grounds": [], "action_due_hours": None,
              "action_label": "", "advisory": [], "missing_data": [],
              "comparison_previous": None, "comparison_baseline": None,
              "immediate_danger_established": False}
    grounds = review["grounds"]
    if key == PHQ9_KEY:
        if type(score) is not int or not 0 <= score <= 27:
            raise ValueError("InvalidPHQ9Score")
        prior, initial = comparison(score, previous), comparison(score, baseline)
        review["comparison_previous"], review["comparison_baseline"] = prior, initial
        if prior["result_id"] is None:
            review["missing_data"].append("Предыдущее измерение этой версии отсутствует")
        if initial["result_id"] is None:
            review["missing_data"].append("Врач не выбрал исходное измерение этой версии")
        absolute = score > 15
        growth = prior["growth_criterion_met"] is True or initial["growth_criterion_met"] is True
        if absolute:
            grounds.append({"code": "phq9_above_15", "family": "absolute", "label": "Сумма PHQ-9 строго больше 15"})
        if growth:
            grounds.append({"code": "phq9_growth_10", "family": "growth", "label": "Рост PHQ-9 не менее чем на 10 баллов"})
        if absolute and growth:
            review.update(severity="urgent_review", action_due_hours=16,
                          action_label="Связаться с пациентом раньше и провести срочную врачебную оценку")
        elif absolute or growth:
            review.update(severity="review_required", action_due_hours=48,
                          action_label="Обсудить результат и определить дальнейшее действие врача")
        if result.get("item9_positive"):
            grounds.append({"code": "phq9_item9_positive", "family": "clarification",
                            "label": "Положительный ответ на вопрос 9 PHQ-9: требуется уточнение"})
            review["advisory"].append("Уточнение ответа на вопрос 9 желательно в течение 12–24 часов. Ответ сам по себе не подтверждает непосредственную угрозу жизни.")
            if review["severity"] == "no_signal":
                review.update(severity="needs_clarification", action_label="Связаться с пациентом и уточнить ответ на вопрос 9")
    elif key == GAD7_KEY:
        if type(score) is not int or not 0 <= score <= 21:
            raise ValueError("InvalidGAD7Score")
        if score >= 15:
            grounds.append({"code": "gad7_high", "family": "absolute", "label": "GAD-7: высокий уровень, 15–21 балл"})
            review.update(severity="urgent_review", action_label="Связаться с пациентом раньше и провести врачебную оценку")
        elif score >= 10:
            grounds.append({"code": "gad7_medium", "family": "absolute", "label": "GAD-7: средний уровень, 10–14 баллов"})
            review.update(severity="review_required", action_label="Обсудить результат на приёме")
        if grounds:
            review["missing_data"].append("Срок медицинского действия по GAD-7 отдельно не согласован; врач задаёт срок задачи")
    elif key == PANIC_KEY:
        if score is not None:
            raise ValueError("PanicScreenHasNoSeveritySum")
        if result.get("criterion_met") is True:
            grounds.append({"code": "panic_screen_positive", "family": "screening", "label": "Выполнен критерий панического скрининга: 4 ответа первого блока и не менее 4 симптомов"})
            review.update(severity="review_required", action_label="Провести клиническую оценку результата панического скрининга")
            review["advisory"].append("Скрининг не подтверждает диагноз панического расстройства.")
    else:
        raise ValueError("UnapprovedClinicalInstrument")
    return review
