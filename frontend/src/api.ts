import { useCallback, useEffect, useState } from "react";
import type { BarrierCategory, Dimension } from "./collection";
import { isTelegramPath } from "./telegramRuntime";

let telegramCredential:string|null=null;
export const sessionToken=()=>isTelegramPath()?telegramCredential:sessionStorage.getItem("compass-token");
export function saveSessionToken(token:string) {if(isTelegramPath())telegramCredential=token;else sessionStorage.setItem("compass-token",token);}
export function clearSessionToken() {if(isTelegramPath())telegramCredential=null;else sessionStorage.removeItem("compass-token");}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = sessionToken();
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
    let code:string|undefined;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
      if(body.detail&&typeof body.detail==="object"&&!Array.isArray(body.detail)) {
        if(typeof body.detail.message==="string")message=body.detail.message;
        if(typeof body.detail.code==="string")code=body.detail.code;
      }
      if (Array.isArray(body.detail))
        message = body.detail.map((e: { msg: string }) => e.msg).join("; ");
    } catch {
      /* A transport error may not contain JSON. */
    }
    if (response.status === 401 && code!=="invalid_credentials" && token && sessionToken() === token)
      window.dispatchEvent(new Event("compass-auth-expired"));
    throw new ApiError(response.status, message,code);
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
  scenario_label?:string|null;
};
export type Patient = {
  id: number;
  full_name: string;
  mis_id: number;
  doctor_id: number;
  created_at: string;
  demo_scenario?: string | null;
  scenario_label?:string|null;
  treatment_status?: string;
  open_tasks?: number;
  in_progress_tasks?: number;
  pending_events?: number;
  last_observation_at?: string | null;
  last_observation_source?: "canonical_clinical"|"numeric_demo"|null;
  latest_clinical_result?: {id:number;instrument_key:string;code:string;name:string;version:string;score:number|null;maximum:number|null;criterion_met:boolean|null;created_at:string}|null;
  scenario_measurement?:{instrument:string;score:number;day:number;version:string|null;created_at:string;source:string;version_confirmed:boolean}|null;
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
  show_if?: {question_id: string; equals: string};
};
export type ClinicalInstrument = {
  key: string; name: string; version: string; instructions: string; questions: Question[];
  source_title: string; source_url: string; source_check: string; license: string;
  license_url: string | null; limitation: string; maximum: number | null;
};
export type ClinicalResult = {
  id: number; patient_id: number; submission_id: number; instrument_key: string;
  definition: ClinicalInstrument; score: number | null; created_at: string;
  answers: Record<string, unknown>;
  result: {kind: "sum" | "panic_screen"; maximum?: number; band?: string; item9_positive?: boolean;
    criterion_met?: boolean; screen_stopped?: boolean; symptoms_yes?: number | null; gates_yes?: number | null;
    triage?: ClinicalTriage;
    synthetic_provenance?: {generated:true;dataset_version:string;fixture_sha256:string;scenario:string;measurement:"generated_current"}};
};
export type ClinicalComparison = {result_id:number|null;score:number|null;created_at:string|null;delta:number|null;growth_criterion_met:boolean|null};
export type ClinicalTriage = {
  rule_version:string; source:string; severity:string; grounds:{code:string;family:string;label:string}[];
  priority?:"CRITICAL"|"HIGH"|"MEDIUM"|"INFO";response_target?:"immediate"|"urgent"|"working_day"|null;
  action_due_hours:number|null; action_label:string; advisory:string[]; missing_data:string[];
  comparison_previous:ClinicalComparison|null;comparison_baseline:ClinicalComparison|null;immediate_danger_established:boolean;
};
export type ReviewTiming = {
  immediate_action_required?:boolean;
  acknowledgement_due_at:string|null;acknowledgement_state:"accepted"|"late"|"overdue"|"pending"|null;
  action_due_at:string|null;action_completed_at:string|null;action_overdue:boolean;as_of:string;
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
  clinical_instrument?: ClinicalInstrument | null;
  is_clinical_scale?: boolean;
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
  emergency_help?:boolean;
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
  source_kind: "assessment" | "support_request" | "clinical_assessment" | "clinical_scenario";
  severity?:string;
  review_timing?:ReviewTiming;
  source_message: {id:number; text:string; created_at:string} | null;
  actions: {task_id:number; title:string; status:string; reply_message_id:number|null; created_at:string}[];
  decision: {
    id: number;
    status: string;
    version: number;
    facts: { form_type: string; score: number|null; risk_flags: string[];triage?:ClinicalTriage;
      instrument_name?:string;instrument_version?:string;source_url?:string;source_title?:string;clinical_result_id?:number;
      system_proposal?:string;case_review?:ScenarioContext };
    missing_data: string[];
    reason: string;
  } | null;
};
export type ScenarioContext={source_case_id:string;case_key:string;title:string;day:number;facts:string[];
  source_file:string|null;source_sha256:string|null;hypothesis:{proposal:string;category:string;missing_data:string[];
    source?:string;priority?:"CRITICAL"|"HIGH"|"MEDIUM";suggested_actions?:string[];
    registry_current_verified?:boolean;review_source?:{title:string;url:string|null};drug_source?:{title:string;url:string;document_url:string;registry_current_verified:boolean}}|null};
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
  survey_title?:string;
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
    timing_excluded_generated?: number; timing_eligible_completed?: number;
    assignment_to_completion: DurationSummary; open_to_completion: DurationSummary;
    delivery_to_completion: DurationSummary; interpretation: string };
};
export type DiaryEntry = { id: number; text: string; shared_with_doctor: boolean; created_at: string;
  observed_at: string | null; observation_kind: "moment" | "day_summary" | null; feeling: string | null; daily_impact: string | null };
