import type { ComponentProps, ReactNode } from "react";
import {
  AlertCircle,
  RefreshCw,
  ArrowRight,
  ClipboardCheck,
} from "lucide-react";

export const date = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Без срока";
export const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11
    ? one
    : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14)
      ? few
      : many;

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button className={`button ${variant} ${className}`} {...props}>
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "good" | "warn" | "purple";
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Avatar({
  name,
  small = false,
}: {
  name: string;
  small?: boolean;
}) {
  return (
    <span className={`avatar ${small ? "small" : ""}`} aria-hidden="true">
      {name
        .split(" ")
        .slice(0, 2)
        .map((s) => s[0])
        .join("")}
    </span>
  );
}
export function ErrorBox({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  if (!message) return null;
  return (
    <div className="error-box" role="alert">
      <AlertCircle size={18} />
      <span>{message}</span>
      {retry && (
        <Button variant="ghost" onClick={retry}>
          <RefreshCw size={15} /> Повторить
        </Button>
      )}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <ClipboardCheck size={28} />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <span className="spinner" /> Загружаем данные…
    </div>
  );
}
export function Heading({
  eyebrow,
  title,
  children,
  action,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {children && <p className="lede">{children}</p>}
      </div>
      {action}
    </div>
  );
}
export function Section({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="section-heading">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
export function TextLink({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button className="text-link" onClick={onClick}>
      {children}
      <ArrowRight size={15} />
    </button>
  );
}
export const availability: Record<string, string> = {
  available: "На связи",
  busy: "Занят",
  offline: "Недоступен",
  on_leave: "В отпуске",
};
export const adherenceLabels: Record<string, string> = {
  followed: "Выполнил(а)",
  not_followed: "Не получилось",
  unknown: "Не могу оценить",
  not_applicable: "Не применимо",
};
export type Notify = (message: string, kind?: "success" | "error") => void;
