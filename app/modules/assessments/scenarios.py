"""Versioned synthetic case facts and review hypotheses, never an automatic prescription."""
from copy import deepcopy
from functools import lru_cache
import json
from pathlib import Path

PATH = Path(__file__).resolve().parents[2] / "db/fixtures/aviandr_cases_v1.json"
RULE_VERSION = "aviandr_case_review_20261027_v1"


@lru_cache
def scenario_catalog() -> dict:
    data = json.loads(PATH.read_text(encoding="utf-8"))
    if data["schema_version"] != "aviandr-cases/1" or data["synthetic"] is not True:
        raise ValueError("InvalidScenarioFixture")
    cases = data["cases"]
    for field in ("key", "mis_id", "username"):
        if len({case[field] for case in cases}) != len(cases):
            raise ValueError("DuplicateScenarioIdentity")
    for case in cases:
        if case["mis_id"] <= 10 or not case["username"].startswith("patient_aviandr_"):
            raise ValueError("ScenarioIdentityCollidesWithExistingDemo")
        if len({step["key"] for step in case["steps"]}) != len(case["steps"]):
            raise ValueError("DuplicateScenarioStep")
    return data


def scenario_for_mis(mis_id: int | None) -> dict | None:
    return next((deepcopy(case) for case in scenario_catalog()["cases"] if case["mis_id"] == mis_id), None)


def scenario_label(mis_id: int | None) -> str | None:
    case = scenario_for_mis(mis_id)
    return f'{case["source_id"]} · {case["title"]}' if case else None


def step_hypothesis(case: dict, step: dict) -> dict:
    """Only the supplied case facts trigger these proposals; no free-text diagnosis."""
    case_id, key = case["source_id"], step["key"]
    proposals = {
        ("P008", "plan"): "Проверить применимость Авиандра к указанному диагнозу и сочетание с эсциталопрамом. В имеющейся ОХЛП послеродовая депрессия не указана как показание; сочетание с СИОЗС требует осторожности. Уточнить беременность и грудное вскармливание. План нуждается в решении врача.",
        ("P008", "epds_baseline"): "Оценить исходное значение EPDS 18 независимо от отсутствия предыдущего измерения. Проверить версию бланка, исходные ответы и актуальное состояние пациентки. Категория тяжести и непосредственная угроза по одной сумме не устанавливаются.",
        ("P008", "epds_followup"): "Сумма EPDS снизилась с 18 до 9. Возможна положительная динамика по опроснику; клиническое улучшение, эффект конкретного препарата и дальнейший план оценивает врач. Нужны сопоставимая версия и исходные ответы.",
        ("P008", "therapy_change"): "В исходном сценарии врач изменил схему. Проверить безопасность записанного изменения и определить наблюдение после него. Снижение EPDS не подтверждает безопасность смены терапии или зарегистрированное показание к Авиандру. Приложение не отменяет препарат и не изменяет назначение в МИС.",
        ("P009", "plan"): "Проверить сочетание Авиандра с алимемазином, включая возможное усиление седативного действия. Оценить сопутствующие препараты и применимость по актуальной инструкции.",
        ("P009", "self_medication"): "Возможно нежелательное взаимодействие самостоятельно добавленного пароксетина с Авиандром. ОХЛП от 16.07.2026 рекомендует осторожность при сочетании с СИОЗС и ингибиторами CYP2D6; она не утверждает неизбежность токсичности. Нужны срочная оценка врача, точные препараты, дозы и время приёма. Интоксикация по сообщению не установлена.",
        ("P009", "symptoms"): "Сообщены выраженная сонливость и шаткость походки на фоне самостоятельного добавления препарата. Нужна срочная врачебная оценка симптомов и сочетаний. Автоматической отмены всех препаратов или фиксированной паузы на 48 часов нет.",
        ("P009", "new_plan"): "В исходном сценарии врач записал сочетание с тразодоном. Проверить его безопасность: тразодон — серотонинергический препарат. Приложение не подтверждает безопасность комбинации; окончательный вывод и лечение определяет врач по актуальной инструкции.",
        ("P010", "missing_labs"): "Для оценки безопасности не хватает сведений о функции почек. Неизвестное значение СКФ не считается нормальным. Уточнить результаты, единицы, метод и дату; не подставлять произвольный срок давности анализа.",
        ("P010", "renal_labs"): "Переданная СКФ 41 ниже порога 60 мл/мин, указанного в имеющейся ОХЛП Авиандра. Возможно противопоказание по функции почек: сверить результат и актуальную инструкцию, оценить пациента. Креатинин 165 без единиц не используется для вычисления СКФ; диагноз ХБП по одному результату не устанавливается.",
        ("P010", "symptoms"): "Сообщены тошнота и отёки на лице на фоне сведений о сниженной функции почек. Нужна срочная врачебная оценка; связь с препаратом и дальнейшие действия подтверждает врач.",
    }
    urgent = (case_id, key) in {("P009", "self_medication"), ("P009", "symptoms"), ("P010", "renal_labs"), ("P010", "symptoms")}
    return {"rule_version": RULE_VERSION, "proposal": proposals.get((case_id, key), "Проверить исходные сведения и определить следующий шаг врача."),
            "severity": "urgent_review" if urgent else "review_required", "category": "required",
            "source": "supplied_scenario_with_manufacturer_leaflet", "source_file": scenario_catalog()["source_file"],
            "drug_source": deepcopy(scenario_catalog()["drug_source"]), "missing_data": list(case["missing_data"]),
            "diagnosis_established": False, "therapy_changed": False, "registry_current_verified": False}
