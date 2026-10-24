import { useEffect, useState } from "react";
import { Compass, X } from "lucide-react";
import type { User } from "./api";
import { Button } from "./UI";
import { useInteractionMotion } from "./Interaction";
import { useNavigationGuard } from "./NavigationGuard";

const guides: Record<string, {view: string; title: string; text: string}[]> = {
  doctor: [
    {view:"patients", title:"Начните с пациента", text:"Найдите человека по имени и откройте карточку. Там собраны ответы, история состояния и следующие действия."},
    {view:"events", title:"Разберите новые события", text:"Посмотрите исходный факт и примите событие в работу. Сам сигнал ещё не является диагнозом или выполненным действием."},
    {view:"tasks", title:"Доведите следующий шаг до результата", text:"Возьмите задачу в работу, опишите выполненное действие и отдельно проверьте, удалось ли устранить затруднение. Новая задача создаётся в карточке пациента."},
    {view:"surveys", title:"Задайте нужные вопросы", text:"Создайте или выберите опрос, опубликуйте и назначьте своим пациентам. Ответы помогут обсудить то, что мешает следовать плану."},
  ],
  patient: [
    {view:"overview", title:"Важное между встречами", text:"На главной — ближайшие шаги и вопросы от врача. Любой честный ответ полезен; отвечать «хорошо» ради баллов не нужно."},
    {view:"state", title:"Посмотрите свою историю", text:"Графики показывают сохранённые наблюдения. Пробелы означают отсутствие данных. Изменения можно обсудить на приёме."},
    {view:"diary", title:"Записывайте в удобном ритме", text:"Дневник добровольный. У каждой записи можно выбрать, оставить её личной или показать врачу."},
    {view:"journey", title:"Продвигайтесь маленькими шагами", text:"Баллы отмечают участие, а карта — игровой прогресс. В демонстрации можно обменять баллы на тестовый купон. Выберите спокойный режим, если игровые элементы вам не подходят."},
  ],
  admin: [
    {view:"overview", title:"Посмотрите общую картину", text:"Здесь только обезличенные показатели клиники. Начните с охвата наблюдениями и прохождения опросов."},
    {view:"barriers", title:"Найдите препятствия", text:"Посмотрите категории затруднений и распределения ответов. Неответ и отсутствие данных не означают отказ от лечения."},
    {view:"actions", title:"Проследите работу клиники", text:"Сравните назначенные действия, выполненные задачи и результаты повторной проверки. Выполнить действие и устранить затруднение — разные события."},
    {view:"sources", title:"Проверьте полноту и защиту", text:"У графиков есть единицы и основания расчёта. Скрытые группы не равны нулю. Настройка приватности не открывает персональные карточки."},
  ],
  coordinator: [
    {view:"overview", title:"Начните с порученных действий", text:"Вам доступны только организационные задачи, которые назначил врач. Клинические ответы и его приватные наблюдения сюда не передаются."},
    {view:"overview", title:"Зафиксируйте выполненное действие", text:"Возьмите задачу в работу и опишите, что сделано. Врач отдельно проверит результат; отметка о выполнении не заменяет эту проверку."},
  ],
};

export function RoleGuide({user, navigate, startSignal}: {user: User; navigate: (view: string) => void; startSignal: number}) {
  const { moving } = useInteractionMotion();
  const guard = useNavigationGuard();
  const storageKey = `compass-guide-v1-${user.id}-${user.role}`;
  const steps = guides[user.role] ?? guides.admin;
  const [hidden, setHidden] = useState(() => {try {return localStorage.getItem(storageKey) === "seen";} catch {return false;}});
  const [step, setStep] = useState(-1);
  useEffect(() => {if (startSignal) {setHidden(false); setStep(0);}}, [startSignal]);
  useEffect(() => {if (step >= 0) document.getElementById("role-guide")?.scrollIntoView({block:"nearest", behavior:moving?"smooth":"auto"});}, [step,moving]);
  function dismiss() {setStep(-1); setHidden(true); try {localStorage.setItem(storageKey,"seen");} catch {/* Optional local preference. */}}
  function go(next: number) {guard.run(()=>{navigate(steps[next].view);setStep(next);});}
  if (hidden && step < 0) return null;
  return <section className="role-guide" id="role-guide" aria-label="Знакомство с кабинетом">
    <span className="guide-mark" aria-hidden="true"><Compass size={26}/></span>
    <div className="guide-copy" aria-live="polite">
      <p className="eyebrow">Compass · {step < 0 ? "Ваш помощник" : `Шаг ${step+1} из ${steps.length}`}</p>
      <h2>{step < 0 ? "Освойтесь в кабинете за несколько шагов" : steps[step].title}</h2>
      <p>{step < 0 ? "Посмотрим, с чего начать и как пройти основной маршрут. Подсказки можно закрыть и снова открыть кнопкой «Как пользоваться»." : steps[step].text}</p>
    </div>
    <div className="guide-actions">
      {step < 0 ? <Button onClick={() => go(0)}>Начать знакомство</Button> : <>
        <Button variant="ghost" disabled={step === 0} onClick={() => go(step-1)}>Назад</Button>
        <Button onClick={() => step+1 === steps.length ? dismiss() : go(step+1)}>{step+1 === steps.length ? "Готово" : "Дальше"}</Button>
      </>}
      <button className="icon-button" aria-label="Закрыть подсказки" onClick={dismiss}><X size={18}/></button>
    </div>
  </section>;
}
