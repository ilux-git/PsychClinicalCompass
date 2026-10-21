"""Synthetic fixtures shared by the demo MIS bootstrap and Compass seed."""
DEMO_PATIENTS = [
    ("Иван Петров", ["F32.1"], ["Sertraline 50mg"]),
    ("Мария Иванова", ["F41.1"], ["Escitalopram 10mg"]),
    ("Александр Соколов", ["F32.1", "F41.1"], ["Fluoxetine 20mg"]),
    ("Елена Кузнецова", ["F43.1"], ["Prazosin 2mg"]),
    ("Дмитрий Волков", ["F32.1"], ["Venlafaxine 75mg"]),
    ("Ольга Смирнова", ["F41.1"], ["Mirtazapine 15mg"]),
    ("Николай Фёдоров", ["F32.1", "F43.1"], ["Duloxetine 60mg"]),
    ("Анна Лебедева", ["F43.1"], ["Clonazepam 0.5mg"]),
    ("Сергей Морозов", ["F32.1"], ["Bupropion 150mg"]),
    ("Татьяна Романова", ["F41.1", "F43.1"], ["Quetiapine 50mg"]),
]

BARRIER_QUESTIONS = [
    {"id": "barriers", "prompt": "Что сейчас мешает выполнять согласованные рекомендации?", "kind": "multiple", "required": True,
     "options": [{"id": key, "label": label} for key, label in [
         ("schedule", "Не подходит график"), ("cost", "Стоимость"), ("unclear", "Не всё понятно"),
         ("discomfort", "Нежелательные ощущения"), ("none", "Сейчас ничего не мешает"), ("other", "Другое")]],
     "minimum": 0, "maximum": 10},
    {"id": "details", "prompt": "Что важно знать вашему врачу?", "kind": "text", "required": False,
     "options": [], "minimum": 0, "maximum": 10},
]

CONTINUATION_QUESTIONS = [
    {"id": "intent", "prompt": "Планируете ли вы продолжать наблюдение в клинике?", "kind": "single", "required": True,
     "options": [{"id": key, "label": label} for key, label in [
         ("yes", "Да"), ("unsure", "Пока не уверен(а)"), ("no", "Нет"), ("prefer_not", "Не хочу отвечать")]],
     "minimum": 0, "maximum": 10},
    {"id": "why", "prompt": "Что повлияло на ваш ответ?", "kind": "text", "required": False, "options": [], "minimum": 0, "maximum": 10},
    {"id": "clarity", "prompt": "Насколько понятны дальнейшие шаги?", "kind": "scale", "required": False,
     "options": [], "minimum": 1, "maximum": 5},
]
