import {useEffect,useRef,useState,type FormEvent} from "react";
import {ArrowRight} from "lucide-react";
import {send,saveSessionToken,type User} from "./api";
import {BrandIdentity,productName} from "./Brand";
import {Button,ErrorBox} from "./UI";
import {isTelegramPath} from "./telegramRuntime";
import anatomy from "./assets/limbus-final.png";

export function Login({ onLogin, sessionMessage }: { onLogin: (user: User) => void; sessionMessage: string }) {
  const [username, setUsername] = useState("doctor");
  const [password, setPassword] = useState("doctor-pass-123");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preset, setPreset] = useState("doctor");
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function login(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await send<{ access_token: string; user: User }>(
        "/auth/login",
        { username, password },
      );
      if (!mounted.current) return;
      saveSessionToken(result.access_token);
      setPassword("");
      onLogin(result.user);
    } catch (error) {
      if (!mounted.current) return;
      setError(
        error instanceof Error ? error.message : "Нет соединения с сервером",
      );
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  function select(value: string) {
    setPreset(value);
    setUsername(value);
    setPassword(
      value.startsWith("patient")
        ? "patient-pass-123"
        : value === "admin"
          ? "admin-pass-123"
          : value === "coordinator" ? "coordinator-pass-123"
          : "doctor-pass-123",
    );
  }
  return (
    <main className="login-page">
      <div className="login-story">
        <a href="/" className="brand">
          <BrandIdentity/>
        </a>
        <div className="login-story-main">
          <figure className="limbus-anatomy" aria-hidden="true"><img src={anatomy} width="5232" height="2944" decoding="async" alt=""/></figure>
        </div>
      </div>
      <div className="login-form-side">
        <form className="login-form" onSubmit={login}>
          <h2>Войти в {productName}</h2>
          <label className="field">
            Роль
            <select disabled={busy} value={preset} onChange={(e) => select(e.target.value)}>
              <option value="doctor">Врач · основные пациенты</option>
              <option value="doctor2">Второй врач · отдельные пациенты</option>
              {Array.from({ length: 10 }, (_, i) => (
                <option key={i} value={`patient${i + 1}`}>
                  Пациент {i + 1}
                </option>
              ))}
              <option value="patient_aviandr_positive">Сценарий P008 · Авиандр, динамика EPDS</option>
              <option value="patient_aviandr_interaction">Сценарий P009 · Авиандр, сочетание препаратов</option>
              <option value="patient_aviandr_renal">Сценарий P010 · Авиандр, функция почек</option>
              <option value="admin">
                Администратор · обезличенная сводка
              </option>
              <option value="coordinator">Координатор · назначенные задачи</option>
            </select>
          </label>
          <label className="field">
            Логин
            <input
              autoComplete="username"
              required
              disabled={busy}
              maxLength={80}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label className="field">
            Пароль
            <input
              type="password"
              autoComplete="current-password"
              required
              disabled={busy}
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <ErrorBox message={error} />
          {sessionMessage && <p className="field-hint" role="status">{sessionMessage}</p>}
          <Button disabled={busy} type="submit">
            {busy ? "Входим…" : "Войти"}
            <ArrowRight size={17} />
          </Button>
          {isTelegramPath() && <p className="field-hint">При каждом новом открытии войдите по логину и паролю. Постоянная привязка к Telegram не создаётся.</p>}

        </form>
      </div>
    </main>
  );
}
