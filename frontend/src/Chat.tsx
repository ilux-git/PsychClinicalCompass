import { createRequestId } from "./requestId";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Send, MessageCircle } from "lucide-react";
import { send, useApi, type ChatMessage } from "./api";
import {
  Badge,
  Button,
  date,
  Empty,
  ErrorBox,
  Loading,
  type Notify,
} from "./UI";
import { useUnsavedForm, type LeavePrompt } from "./NavigationGuard";
import { AnimatePresence, m, motionTokens, useInteractionMotion } from "./Interaction";

const messagePrompt:LeavePrompt={eyebrow:"Неотправленное сообщение",title:"Оставить сообщение в форме?",message:"Сообщение ещё не отправлено. Вернитесь к переписке, чтобы дописать и отправить его. При переходе без сохранения текст будет потерян.",stayLabel:"Продолжить сообщение"};

export function Chat({
  patientId,
  role,
  simulated = false,
  notify,
  onObservation,
  scope,
}: {
  patientId: number;
  role: "doctor" | "patient";
  simulated?: boolean;
  notify: Notify;
  onObservation?: (message: ChatMessage) => void;
  scope?:string;
}) {
  const messages = useApi<ChatMessage[]>(
    `/conversations/${patientId}/messages`,
    5000,
  );
  const [text, setText] = useState("");
  const [supportRequested,setSupportRequested] = useState(false);
  const requests = useApi<{message_id:number; text:string; created_at:string; status:string; acknowledged_at:string|null}[]>(
    role === "patient" ? `/patients/${patientId}/support-requests` : null, 5000);
  const [busy, setBusy] = useState(false);
  const [sendError,setSendError] = useState("");
  const errorResult=useRef<HTMLDivElement>(null),errorId=useId();
  useEffect(()=>{if(sendError)errorResult.current?.querySelector<HTMLElement>('.error-box')?.focus();},[sendError]);
  const composer=useRef<HTMLTextAreaElement>(null);
  const sendButton=useRef<HTMLButtonElement>(null),resumeComposer=useRef(false);
  useEffect(()=>{
    if(busy||!resumeComposer.current)return;
    resumeComposer.current=false;
    const active=document.activeElement;
    if(active===document.body||active===sendButton.current||active===composer.current)composer.current?.focus({preventScroll:true});
  },[busy]);
  const {clear:clearGuard} = useUnsavedForm({dirty:Boolean(text || supportRequested),pending:busy,prompt:messagePrompt,scope,focus:()=>composer.current?.focus()});
  const list = useRef<HTMLDivElement>(null);
  const lastMessage = useRef<number | null>(null);
  const following = useRef(true);
  const scrollRevision = useRef(0);
  const [newMessages,setNewMessages] = useState(false);
  const {moving,transition} = useInteractionMotion();
  const latestId = messages.data?.at(-1)?.id;
  useEffect(()=>{
    if(latestId===undefined || latestId===lastMessage.current || !list.current)return;
    const initial=lastMessage.current===null;
    lastMessage.current=latestId;
    if(initial || following.current) {
      list.current.scrollTop=list.current.scrollHeight;
      setNewMessages(false);
    } else setNewMessages(true);
  },[latestId]);
  function showLatest() {
    list.current?.scrollTo({top:list.current.scrollHeight,behavior:moving?"smooth":"auto"});
    list.current?.focus({preventScroll:true});
    following.current=true;setNewMessages(false);
  }
  const request = useRef({ text: "", id: "" });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    const signature = JSON.stringify([text,supportRequested]);
    if (request.current.text !== signature || !request.current.id)
      request.current = { text:signature, id: createRequestId() };
    const scrollAtSend=scrollRevision.current;
    resumeComposer.current=document.activeElement===composer.current||document.activeElement===sendButton.current;
    setSendError("");setBusy(true);
    try {
      await send(`/conversations/${patientId}/messages`, {
        text,
        channel: simulated ? `tg_${role}` : "web",
        client_request_id: request.current.id,
        support_requested: supportRequested,
      });
      setText("");
      setSupportRequested(false);
      clearGuard();
      if(scrollRevision.current===scrollAtSend)following.current=true;
      request.current = { text: "", id: "" };
      messages.reload();
      requests.reload();
      if (supportRequested) notify("Запрос поддержки сохранён. Он появится в очереди лечащего врача; ответ не мгновенный.");
    } catch (error) {
      resumeComposer.current=false;
      setSendError(error instanceof Error ? error.message : "Сообщение не отправлено");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="chat-panel">
      {simulated && (
        <div className="channel-notice">
          <MessageCircle size={17} />
          <span>
            Симулятор Telegram. Сообщения сохраняются в общей истории; внешняя
            доставка не выполняется.
          </span>
        </div>
      )}
      <ErrorBox message={messages.error} retry={messages.reload} />
      <div className="chat-history">
      {!messages.data ? (
        messages.loading ? (
          <Loading />
        ) : (
          <p className="muted">История переписки пока недоступна.</p>
        )
      ) : (
        <div className="message-list" ref={list} role="log" aria-live="polite" aria-relevant="additions" aria-label="История переписки"
          tabIndex={0} onScroll={event=>{scrollRevision.current++;const node=event.currentTarget;following.current=node.scrollHeight-node.scrollTop-node.clientHeight<48;if(following.current)setNewMessages(false);}}>
          {!messages.data?.length && (
            <Empty title="Диалог ещё не начат">
              Можно написать сообщение — оно сохранится в истории.
            </Empty>
          )}
          {messages.data?.map((message) => (
            <article
              key={message.id}
              className={`message ${message.sender_role === role ? "own" : ""}`}
            >
              <div className="message-meta">
                <strong>
                  {message.sender_role === "doctor" ? "Врач" : "Пациент"}
                </strong>
                <time dateTime={message.created_at}>{date(message.created_at)}</time>
              </div>
              <p>{message.text}</p>
              {message.support_requested && <Badge tone="purple">Пациент попросил поддержку</Badge>}
              <div className="message-delivery">
                {message.channel === "web"
                  ? "Сохранено"
                  : message.status === "simulated"
                    ? "Демодоставка"
                    : message.status === "queued"
                      ? "В очереди симулятора"
                      : "Получено из канала"}
              </div>
              {role === "doctor" && onObservation && <Button variant="ghost" onClick={() => onObservation(message)}>Наблюдение к сообщению</Button>}
            </article>
          ))}
        </div>
      )}
      <AnimatePresence>{newMessages&&<m.div className="new-messages" role="status" initial={{opacity:0,y:moving?motionTokens.distance.small:0}} animate={{opacity:1,y:0}} exit={{opacity:0}} transition={transition}><Button variant="secondary" onClick={showLatest}>Новые сообщения · Показать</Button></m.div>}</AnimatePresence>
      </div>
      {(messages.data?.length??0)>=100&&<p className="field-hint">Показаны последние 100 сообщений диалога.</p>}
      <form onSubmit={submit}>
      <div ref={errorResult} id={errorId}><ErrorBox message={sendError}/></div>
      <fieldset className="form-fields" disabled={busy} aria-busy={busy} aria-describedby={sendError?errorId:undefined}>
      {role === "patient" && <label className="support-request-choice"><input type="checkbox" checked={supportRequested} onChange={e => {setSendError("");setSupportRequested(e.target.checked);}}/><span>Мне нужна поддержка по этому сообщению<small>Создаст отдельное событие лечащему врачу. Здесь нет экстренной или круглосуточной службы.</small></span></label>}
      <div className="message-compose">
        <textarea
          ref={composer}
          aria-label="Текст сообщения"
          maxLength={4096}
          rows={2}
          value={text}
          onChange={(e) => {setSendError("");setText(e.target.value);}}
          placeholder="Написать сообщение…"
          required
        />
        <Button
          ref={sendButton}
          aria-label="Отправить сообщение"
          type="submit"
          disabled={busy || !text.trim()}
        >
          <Send size={18} />
          <span>{busy?"Отправляем…":"Отправить"}</span>
        </Button>
      </div>
      </fieldset>
      </form>
      {role === "patient" && <>
        <ErrorBox message={requests.error} retry={requests.reload}/>
        {!!requests.data?.length && <details className="support-progress"><summary>Мои запросы поддержки ({requests.data.length})</summary>{requests.data.map(item => <article key={item.message_id}>
          <Badge tone={item.acknowledged_at ? "purple" : "muted"}>{item.acknowledged_at ? "Врач принял в работу" : item.status === "queued" ? "Подготавливается для очереди врача" : "Ожидает разбора врачом"}</Badge>
          <p>{item.text}</p><small>{date(item.created_at)}{item.acknowledged_at ? ` · принято ${date(item.acknowledged_at)}` : ""}</small>
        </article>)}</details>}
      </>}
      <p className="field-hint">
        История обновляется автоматически. Статус врача не означает
        круглосуточное наблюдение.
      </p>
    </div>
  );
}
