import { useRef, useState, type FormEvent } from "react";
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

export function Chat({
  patientId,
  role,
  simulated = false,
  notify,
  onObservation,
}: {
  patientId: number;
  role: "doctor" | "patient";
  simulated?: boolean;
  notify: Notify;
  onObservation?: (message: ChatMessage) => void;
}) {
  const messages = useApi<ChatMessage[]>(
    `/conversations/${patientId}/messages`,
    5000,
  );
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef({ text: "", id: "" });
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    if (request.current.text !== text || !request.current.id)
      request.current = { text, id: crypto.randomUUID() };
    setBusy(true);
    try {
      await send(`/conversations/${patientId}/messages`, {
        text,
        channel: simulated ? `tg_${role}` : "web",
        client_request_id: request.current.id,
      });
      setText("");
      request.current = { text: "", id: "" };
      messages.reload();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Сообщение не отправлено",
        "error",
      );
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
      {!messages.data ? (
        messages.loading ? (
          <Loading />
        ) : (
          <p className="muted">История переписки пока недоступна.</p>
        )
      ) : (
        <div className="message-list" aria-label="История переписки">
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
                <time>{date(message.created_at)}</time>
              </div>
              <p>{message.text}</p>
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
      <form onSubmit={submit} className="message-compose">
        <textarea
          aria-label="Текст сообщения"
          maxLength={4096}
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Написать сообщение…"
          required
        />
        <Button
          aria-label="Отправить сообщение"
          type="submit"
          disabled={busy || !text.trim()}
        >
          <Send size={18} />
        </Button>
      </form>
      <p className="field-hint">
        История обновляется автоматически. Статус врача не означает
        круглосуточное наблюдение.
      </p>
    </div>
  );
}
