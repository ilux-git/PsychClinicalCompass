"""Physician alert protocol, 27 October; priority is not a diagnosis or risk prediction."""
from copy import deepcopy
import re

RULE_VERSION = "medical_alerts_20261027_v2"
SOURCE = "physician_alerts_2026-10-27"
SOURCE_SHA256 = "9a7cf5c04d08218137b9cb5ea55f1c228a4e82113f08bec91335d603ff4e1245"
SOURCE_TITLE = "Алерты.txt · уточнение врача 27.10.2026"


def assess_current_review(*args, **kwargs):
    # The user explicitly retained all previously approved numeric boundaries.
    from app.modules.assessments.triage import assess_review

    review = deepcopy(assess_review(*args, **kwargs))
    review.update(rule_version=RULE_VERSION, source=SOURCE, source_sha256=SOURCE_SHA256,
                  action_due_hours=None, acknowledgement_minutes=None)
    if any(ground["code"] == "phq9_item9_positive" for ground in review["grounds"]):
        review["severity"] = "urgent_review"
        review["advisory"] = ["Положительный ответ на вопрос 9 требует срочного контакта и оценки врача. Он сам по себе не подтверждает непосредственную угрозу жизни."]
    severity = review["severity"]
    review["priority"] = "HIGH" if severity == "urgent_review" else "MEDIUM" if severity in {"review_required", "needs_clarification"} else "INFO"
    review["response_target"] = "urgent" if severity == "urgent_review" else "working_day" if review["grounds"] else None
    if review["grounds"]:
        review["action_label"] = "Срочно связаться с пациентом и провести врачебную оценку" if severity == "urgent_review" else "Ознакомиться в течение рабочего дня и определить действие врача"
        review["missing_data"] = [text for text in review["missing_data"] if "Срок медицинского действия по GAD-7" not in text]
        review["missing_data"].append("Врач задаёт точное время задачи; рабочие часы клиники не определены")
    return review


# Bounded, first-person statements from the agreed protocol. Ambiguous phrases,
# quotations and hypothetical questions do not establish an immediate threat.
START = r"(?:^|[.!?\n]\s*)"
IMMEDIATE = re.compile(START + r"я\s+(?:(?:прямо\s+)?сейчас\s+(?:убью\s+себя|покончу\s+с\s+собой|совершу\s+суицид|причиню\s+вред\s+реб[её]нку|убью\s+реб[её]нка)|уже\s+стою\s+на\s+подоконнике)\b", re.I)
ACUTE = re.compile(START + r"(?:у\s+меня\s+спутанность\s+сознания|я\s+(?:не\s+могу\s+стоять|(?:упал|упала|падаю)\s+в\s+обморок|(?:потерял|потеряла)\s+сознание))\b", re.I)
ADVERSE = re.compile(START + r"(?:у\s+меня\s+(?:от[её]к(?:ло)?\s+лиц[оа]|(?:сильная\s+)?сыпь)|меня\s+сильно\s+тошнит|мо[её]\s+лицо\s+отекло)\b", re.I)
SELF_CHANGE = re.compile(START + r"я\s+(?:сам(?:а)?|самостоятельно|без\s+назначения\s+врача)\s+(?:начал(?:а)?(?:\s+принимать)?|добавил(?:а)?|купил(?:а)?|принимаю)\s+[^.!?\n]{0,80}(?:пароксетин|эсциталопрам|тразодон|препарат|лекарств|таблетк|антидепрессант)", re.I)
MILD = re.compile(r"(?:немного\s+кружится\s+голова|л[её]гкое\s+головокружение)", re.I)
EARLY = re.compile(r"(?:первые\s+дни|начала\s+при[её]ма)", re.I)
ELLIPTIC_INTENT = re.compile(r"^я\s+сейчас\s+это\s+сделаю[.!\s]*$", re.I)
SELF_HARM_TOPIC = re.compile(r"(?:суицид|убить\s+себя|покончить\s+с\s+собой|причинить\s+себе\s+вред)", re.I)


def message_signal(text: str, *, aviandr_context: bool = False, immediate_intent_context: bool = False):
    value = text.strip()
    if IMMEDIATE.search(value) or (immediate_intent_context and ELLIPTIC_INTENT.fullmatch(value)):
        priority, code, title = "CRITICAL", "reported_immediate_threat", "Сообщение о возможной непосредственной угрозе"
    elif aviandr_context and ACUTE.search(value):
        priority, code, title = "CRITICAL", "reported_acute_symptoms", "Сообщены острые симптомы на фоне сведений об Авиандре"
    elif ADVERSE.search(value):
        priority, code, title = "HIGH", "reported_adverse_symptoms", "Сообщены симптомы возможного нежелательного явления"
    elif SELF_CHANGE.search(value):
        priority, code, title = "HIGH", "reported_self_medication", "Сообщено самостоятельное изменение лекарств"
    elif aviandr_context and MILD.search(value) and EARLY.search(value):
        priority, code, title = "MEDIUM", "reported_mild_dizziness", "Сообщено лёгкое головокружение в начале приёма"
    else:
        return None
    urgent = priority in {"CRITICAL", "HIGH"}
    return {"rule_version": RULE_VERSION, "source": SOURCE, "source_sha256": SOURCE_SHA256,
        "priority": priority, "code": code, "title": title,
        "severity": "critical_review" if priority == "CRITICAL" else "urgent_review" if urgent else "review_required",
        "proposal": ("Немедленно оценить сообщение и связаться с пациентом. Не ждать переписки при угрозе жизни; пациенту доступны номера экстренной помощи. " if priority == "CRITICAL" else
                     "Срочно связаться с пациентом, уточнить состояние и фактические препараты. " if urgent else
                     "Ознакомиться в течение рабочего дня, уточнить жалобы и определить необходимость контакта. ") +
                    "Слова пациента — основание для оценки; интоксикация, причинная связь и новый диагноз автоматически не устанавливаются. Препараты автоматически не назначаются и не отменяются.",
        "category": "required", "acknowledgement_minutes": 5 if priority == "CRITICAL" else None,
        "suggested_actions": ["Связаться с пациентом", "Зафиксировать клиническое действие", "Проверить результат"],
        "review_source": {"title": SOURCE_TITLE, "url": None}, "missing_data": ["Требуется оценка врача и уточнение фактического состояния"],
        "immediate_danger_established": False, "diagnosis_established": False, "therapy_changed": False}
