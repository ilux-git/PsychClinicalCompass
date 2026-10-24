import { useCallback, useEffect, useState } from "react";
import type { BarrierCategory, Dimension } from "./collection";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = sessionStorage.getItem("compass-token");
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(
      0,
      "Нет соединения с сервером. Проверьте подключение и повторите попытку.",
    );
  }
  if (!response.ok) {
    let message = "Не удалось выполнить запрос. Повторите попытку.";
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
      if (Array.isArray(body.detail))
        message = body.detail.map((e: { msg: string }) => e.msg).join("; ");
    } catch {
      /* A transport error may not contain JSON. */
    }
    if (response.status === 401)
      window.dispatchEvent(new Event("compass-auth-expired"));
    throw new ApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}

export const send = <T>(path: string, body: unknown, method = "POST") =>
  api<T>(path, { method, body: JSON.stringify(body) });

export function useApi<T>(path: string | null, poll = 0, refreshSignal = 0) {
  const [resource, setResource] = useState<{ path: string; value: T }>();
  const [error, setError] = useState("");
  const [errorStatus,setErrorStatus]=useState<number|null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const data = resource?.path === path ? resource.value : undefined;
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const controller = new AbortController();
    if (!path) {
      setResource(undefined);
      setError("");
      setErrorStatus(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    setErrorStatus(null);
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await api<T>(path, { signal: controller.signal });
        if (active) {
          setResource({ path, value: result });
          setError("");
          setErrorStatus(null);
        }
      } catch (error) {
        if (active) {
          if (error instanceof ApiError && (error.status === 403 || error.status === 404)) setResource(undefined);
          setError(error instanceof Error ? error.message : "Нет соединения");
          setErrorStatus(error instanceof ApiError?error.status:0);
        }
      } finally {
        inFlight = false;
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = poll ? setInterval(load, poll) : null;
    return () => {
      active = false;
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [path, revision, poll, refreshSignal]);
  return { data, error, errorStatus, loading: Boolean(path) && data === undefined && loading,
    refreshing: loading && data !== undefined, reload };
}

export type User = {
  id: number;
  username: string;
  display_name: string;
  role: "doctor" | "patient" | "admin" | "coordinator";
  patient_id: number | null;
  availability: string;
};
export type Patient = {
  id: number;
  full_name: string;
  mis_id: number;
  doctor_id: number;
  created_at: string;
  demo_scenario?: string | null;
  treatment_status?: string;
  open_tasks?: number;
  in_progress_tasks?: number;
  pending_events?: number;
  last_observation_at?: string | null;
};
export type Card = Patient & {
  mis: {
    source: string;
    status: string;
    full_name?: string;
    diagnoses: string[];
    prescriptions: string[];
  };
  doctor: { name: string; availability: string } | null;
};
export type Choice = { id: string; label: string; analytics_category?: BarrierCategory | null; exclusive?: boolean };
export type Question = {
  id: string;
  prompt: string;
  kind: "single" | "multiple" | "text" | "scale";
  dimension?: Dimension | null;
  required: boolean;
  options: Choice[];
  minimum: number;
  maximum: number;
};
export type Survey = {
  id: number;
  title: string;
  description: string;
  purpose: string;
  questions: Question[];
  version: number;
  previous_version_id: number | null;
  published_at: string | null;
};
export type Draft = Omit<
  Survey,
  "id" | "version" | "previous_version_id" | "published_at"
> &
  Partial<
    Pick<Survey, "id" | "version" | "previous_version_id" | "published_at">
  >;
export type Assignment = {
  id: number;
  patient_id: number;
  patient_name: string;
  status: string;
  due_at: string | null;
  created_at: string;
  first_opened_at: string | null;
  draft_updated_at?: string | null;
  survey: Survey;
  submission: {
    id: number;
    answers: Record<string, unknown>;
    created_at: string;
  } | null;
};
export type Participation = {
  assigned: number;
  completed: number;
  pending: number;
  progress_percent: number | null;
  history: { assignment_id: number; title: string; completed_at: string }[];
  message: string;
};
export type ChatMessage = {
  id: number;
  sender_role: string;
  text: string;
  channel: string;
  status: string;
  support_requested: boolean;
  created_at: string;
};
export type Note = {
  id: number;
  text: string;
  source_type: string;
  source_id: number | null;
  dimension: Dimension | null;
  doctor_id: number;
  doctor_name: string;
  created_at: string;
};
export type Task = {
  id: number;
  title: string;
  status: string;
  due_at: string | null;
};
export type Adherence = {
  id: number;
  recommendation: string;
  status: string;
  reason: string;
  created_at: string;
};
export type Assessment = {
  id: number;
  form_type: string;
  form_version: string;
  answers: number[];
  score: number;
  risk_flags: string[];
  created_at: string;
};
export type Alert = {
  id: number;
  rule_id: string;
  rule_version: string;
  patient_id: number;
  patient_name: string;
  reason: string;
  status: string;
  created_at: string;
  source_kind: "assessment" | "support_request";
  source_message: {id:number; text:string; created_at:string} | null;
  actions: {task_id:number; title:string; status:string; reply_message_id:number|null; created_at:string}[];
  decision: {
    id: number;
    status: string;
    version: number;
    facts: { form_type: string; score: number; risk_flags: string[] };
    missing_data: string[];
    reason: string;
  } | null;
};
export type ChartQuestion = {
  survey_id: number;
  survey_title: string;
  version: number;
  purpose: string;
  question_id: string;
  prompt: string;
  kind: string;
  dimension: Dimension | null;
  respondents: number;
  options: { id: string; label: string; count: number }[];
};
export type Quote = {
  id?:number;
  assignment_id?:number;
  submission_id?:number;
  question_id?:string;
  patient_id: number;
  patient_name: string;
  text: string;
  created_at: string;
  prompt?: string;
  recommendation?: string;
  status?: string;
};
export type Dashboard = {
  period: {since:string|null;until_exclusive:string|null;cohort:"assignments_created_in_period"};
  patients_total: number;
  assigned: number;
  completed: number;
  pending: number;
  completion_rate: number | null;
  patients_with_feedback: number;
  patients_without_feedback: number;
  patients_without_assignments: number;
  overdue_assignments: number;
  questions: ChartQuestion[];
  quotes: Quote[];
  adherence: {
    reports: number;
    statuses: Record<string, number>;
    patients_without_reports: number;
    reasons: Quote[];
  };
  patients: (Pick<Patient, "id" | "full_name"> & {
    assigned: number;
    completed: number;
    observation_status: string;
  })[];
  interpretation: string;
  collection: CollectionMetrics;
};

export type DurationSummary = { known: number; unknown: number; median_seconds: number | null };
export type CollectionMetrics = {
  dimensions: { code: Dimension; label: string; question_versions: number; assigned_patients: number;
    responding_patients: number; patients_without_answer: number; patients_without_assignment: number;
    coverage_percent: number | null; answers: number; inferred_score: null }[];
  journey: { assigned: number; opened: number; completed: number; opened_not_completed: number;
    not_opened_not_completed: number; completed_without_open_record: number; completed_after_open: number;
    opening_rate_percent: number | null; completion_after_open_percent: number | null;
    assignment_to_completion: DurationSummary; open_to_completion: DurationSummary;
    delivery_to_completion: DurationSummary; interpretation: string };
};
export type DiaryEntry = { id: number; text: string; shared_with_doctor: boolean; created_at: string;
  observed_at: string | null; observation_kind: "moment" | "day_summary" | null; feeling: string | null; daily_impact: string | null };
