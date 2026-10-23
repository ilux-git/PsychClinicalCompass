"""User-defined areas of observation, not diagnostic scales or personality scores."""
from typing import Literal

ObservationDimension = Literal["readiness", "approach_trust", "constraints", "recommendation_consistency"]
BarrierCategory = Literal["financial", "time", "family", "other", "none", "unknown", "declined"]

BARRIER_CATEGORIES = {
    "financial": "Финансовые", "time": "Время и расписание", "family": "Семейные",
    "other": "Другие", "none": "Пациент явно указал отсутствие ограничений", "unclassified": "Без категории врача",
    "unknown": "Пациент затрудняется уточнить", "declined": "Пациент отказался отвечать",
}

DIMENSIONS = {
    "readiness": "Заинтересованность: готовность прикладывать усилия",
    "approach_trust": "Лояльность: доверие предлагаемому подходу",
    "constraints": "Ограничения и препятствия",
    "recommendation_consistency": "Организованность: выполнение рекомендаций",
}
