"""Immutable, physician-selected instrument editions; never inferred from a survey title.

New wording or response anchors require a new key. The legacy numeric assessment API
does not acquire this provenance by accepting a client-supplied version string.
"""
from copy import deepcopy

from fastapi import HTTPException


PHQ9_KEY = "phq9_zolotareva_2023_v1"
GAD7_KEY = "gad7_cr457_3_g2_v1"
PANIC_KEY = "phq_panic_cr456_3_g3_v1"


def single(qid: str, prompt: str, labels: list[str], *, gate: bool = False) -> dict:
    question = {"id": qid, "prompt": prompt, "kind": "single", "required": True,
                "options": [{"id": f"n{i}", "label": label} for i, label in enumerate(labels)],
                "minimum": 0, "maximum": len(labels) - 1}
    if gate:
        question["show_if"] = {"question_id": "q1", "equals": "n1"}
    return question


def numbered(prompts: list[str], labels: list[str]) -> list[dict]:
    return [single(f"q{i}", prompt, labels) for i, prompt in enumerate(prompts, 1)]


_CATALOG = {
    PHQ9_KEY: {
        "key": PHQ9_KEY, "name": "PHQ-9 · депрессивные симптомы", "version": "Золотарёва, 2023 · v1",
        "instructions": "Оцените, пожалуйста, насколько часто следующие проблемы беспокоили вас в течение прошедших двух недель. Для ответов используйте следующую шкалу.",
        "source_title": "А. А. Золотарева. Клиническая и специальная психология. 2023;12(4):107–121, приложение, с. 121.",
        "source_url": "https://psyjournals.ru/journals/cpse/archive/2023_n4/Zolotareva",
        "license": "© А. А. Золотарева, 2023. CC BY-NC 4.0. Некоммерческий демонстрационный прототип.",
        "license_url": "https://creativecommons.org/licenses/by-nc/4.0/",
        "source_check": "Бланк сверен с приложением статьи, 26.10.2026.",
        "limitation": "Исследование адаптации выполнено в общей популяции взрослых; автор указывает на необходимость дальнейшей клинической проверки. Результат не является диагнозом.",
        "maximum": 27,
        "questions": numbered([
            "Снижение интереса и удовольствия от привычных дел",
            "Чувство подавленности или безнадежности",
            "Проблемы со сном (неспособность заснуть, раннее пробуждение или слишком долгий сон)",
            "Чувство усталости или недостатка энергии",
            "Плохой аппетит или переедание",
            "Плохое мнение о себе или чувство, что не смог оправдать ожиданий моей семьи",
            "Проблемы с концентрацией внимания (например, при чтении газеты или просмотре телевизионной передачи)",
            "Замедленность движений или речи, которая стала заметна другим людям, или, напротив, суетливость, когда движения и речь стали более быстрыми и беспокойными",
            "Мысли о том, что мне бы хотелось умереть или причинить себе боль",
        ], ["Совсем нет", "В течение нескольких дней", "Более, чем половину этого времени", "Почти каждый день"]),
    },
    GAD7_KEY: {
        "key": GAD7_KEY, "name": "GAD-7 · тревожные симптомы", "version": "КР 457_3, Г2 · v1",
        "instructions": "Как часто за последние 2 недели Вас беспокоили следующие проблемы?",
        "source_title": "Клинические рекомендации «Генерализованное тревожное расстройство», 457_3, приложение Г2, с. 86.",
        "source_url": "https://cr.minzdrav.gov.ru/view-cr/457_3",
        "license": "Бланк предоставлен врачом в MAB_Answ.txt; источник — опубликованные КР. Права для коммерческого использования требуют отдельной проверки.",
        "license_url": None,
        "source_check": "Бланк и ключ сверены с официальным PDF 457_3, 26.10.2026.",
        "limitation": "Скрининг тревожных симптомов, требующий клинической оценки; результат не является диагнозом.",
        "maximum": 21,
        "questions": numbered([
            "Повышенная нервная возбудимость, беспокойство и раздражительность",
            "Неспособность справиться с волнением",
            "Чрезмерное беспокойство по разному поводу",
            "Неспособность расслабиться",
            "Крайняя степень беспокойства: «не могу найти себе место»",
            "Легко поддаюсь чувству беспокойства или раздражительности",
            "Опасение чего-то страшного",
        ], ["Никогда", "Несколько дней", "Более половины дней", "Почти каждый день"]),
    },
    PANIC_KEY: {
        "key": PANIC_KEY, "name": "PHQ · панические атаки", "version": "КР 456_3, Г3 · v1",
        "instructions": "Вопросы о приступах тревоги. Отвечайте «Да» или «Нет». Если на первый вопрос Вы ответили «Нет», остальные вопросы не заполняются. Вопросы о симптомах относятся к последнему приступу.",
        "source_title": "Клинические рекомендации «Паническое расстройство», 456_3, приложение Г3. Бланк из MAB_Answ.txt, выбран врачом 26.10.2026.",
        "source_url": "https://cr.minzdrav.gov.ru/view-cr/456_3",
        "license": "Бланк предоставлен врачом в MAB_Answ.txt. Права для коммерческого использования требуют отдельной проверки.",
        "license_url": None,
        "source_check": "Текст сверен с предоставленным врачом файлом. Независимая сверка PDF 456_3 пока не завершена.",
        "limitation": "Панический модуль PHQ не является PHQ-9. Критерий скрининга не устанавливает диагноз; общего балла тяжести нет.",
        "maximum": None,
        "questions": [
            single("q1", "Испытывали ли вы приступы (атаки) внезапной тревоги, страха или ужаса в течение последних 4 месяцев?", ["Нет", "Да"]),
            *[single(f"q{i}", prompt, ["Нет", "Да"], gate=True) for i, prompt in enumerate([
                "Были ли у вас подобные приступы когда-нибудь прежде?",
                "Возникают ли некоторые из этих приступов неожиданно, вне связи с определенной ситуацией, где бы вы ощущали беспокойство или дискомфорт?",
                "Есть ли у вас боязнь приступа или его последствий?",
                "Во время последнего приступа: поверхностное, учащенное дыхание",
                "Во время последнего приступа: сердцебиение, пульсацию, перебои в работе сердца или ощущение его остановки",
                "Во время последнего приступа: боль или дискомфорт в левой половине грудной клетки",
                "Во время последнего приступа: потливость",
                "Во время последнего приступа: ощущение нехватки воздуха, одышку",
                "Во время последнего приступа: волны жара или холода",
                "Во время последнего приступа: тошнота, дискомфорт в желудке, понос или позывы к нему",
                "Во время последнего приступа: головокружение, неустойчивость, туман в голове или предобморочное состояние",
                "Во время последнего приступа: ощущения покалывания или онемения в теле или конечностях",
                "Во время последнего приступа: дрожание в теле, конечностях, подергивания или стягивание тела (конечностей)",
                "Во время последнего приступа: страх смерти или необратимых последствий приступа?",
            ], 2)],
        ],
    },
}


def instrument(key: str) -> dict:
    if key not in _CATALOG:
        raise HTTPException(404, "Версия клинического опросника не найдена")
    return deepcopy(_CATALOG[key])


def catalog() -> list[dict]:
    return [instrument(key) for key in _CATALOG]


def visible_questions(questions: list[dict], answers: dict) -> list[dict]:
    return [q for q in questions if not q.get("show_if") or
            answers.get(q["show_if"]["question_id"]) == q["show_if"]["equals"]]


def calculate(key: str, answers: dict) -> tuple[int | None, dict]:
    """Called after strict canonical-answer validation; missing values are never zero."""
    if key == PANIC_KEY:
        if answers["q1"] == "n0":
            return None, {"kind": "panic_screen", "criterion_met": False,
                          "screen_stopped": True, "symptoms_yes": None, "gates_yes": None}
        gates = sum(answers[f"q{i}"] == "n1" for i in range(1, 5))
        symptoms = sum(answers[f"q{i}"] == "n1" for i in range(5, 16))
        return None, {"kind": "panic_screen", "criterion_met": gates == 4 and symptoms >= 4,
                      "screen_stopped": False, "symptoms_yes": symptoms, "gates_yes": gates}
    spec = instrument(key)
    values = [int(answers[q["id"]][1:]) for q in spec["questions"]]
    score = sum(values)
    result = {"kind": "sum", "maximum": spec["maximum"]}
    if key == PHQ9_KEY:
        result["item9_positive"] = values[8] > 0
    elif key == GAD7_KEY:
        result["band"] = ("Минимальный" if score < 5 else "Умеренный" if score < 10
                          else "Средний" if score < 15 else "Высокий")
    return score, result
