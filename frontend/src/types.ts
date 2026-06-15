// Shared types mirroring Krishna's Flask backend response shapes.

export type Status = "green" | "amber" | "red";

export type AssessAction =
  | "continue_care"
  | "watch_closely"
  | "show_doctor_today"
  | "call_108";

// The five backend symptom keys. Order here drives the checklist UI.
export const SYMPTOM_KEYS = [
  "fever",
  "smell",
  "spreading_redness",
  "discharge",
  "increasing_pain",
] as const;

export type SymptomKey = (typeof SYMPTOM_KEYS)[number];

export type Symptoms = Record<SymptomKey, boolean>;

export const EMPTY_SYMPTOMS: Symptoms = {
  fever: false,
  smell: false,
  spreading_redness: false,
  discharge: false,
  increasing_pain: false,
};

// POST /analyze (or /analyze-real) response. `message` is optional and
// intentionally NOT shown. `mock` and `debug` are optional; `debug` (only sent
// by /analyze-real) is intentionally ignored by the UI.
export interface AnalyzeResponse {
  change_score: number;
  redness_delta: number;
  border_change: number;
  disclaimer?: string;
  message?: string;
  mock?: boolean;
  debug?: Record<string, unknown>;
  // Advanced non-diagnostic visual metrics, only from /analyze-real. Optional
  // so the mock /analyze flow (which omits them) stays compatible.
  dark_area_delta?: number;
  yellow_area_delta?: number;
  wound_area_delta?: number;
  combined_border_change?: number;
}

export type CaptureCheckStatus = "good" | "bad_lighting" | "blurry";

export type DistanceStatus = "good" | "too_close" | "too_far" | "unknown";
export type FramingStatus = "good" | "off_center" | "guide_only" | "unknown";

export interface CaptureCheckResponse {
  status: CaptureCheckStatus;
  lighting: "good" | "too_dark" | "too_bright" | string;
  brightness: number;
  blur: "sharp" | "blurry" | string;
  blur_score: number;
  framing: "guide_only" | string;
  message: string;
  // Optional, backwards-compatible placement signals. The backend may omit
  // these on older builds; treat missing as "unknown". Absolute distance needs
  // a scale reference we don't have yet, so it stays "unknown" — never faked.
  framing_status?: FramingStatus;
  framing_message?: string;
  distance_status?: DistanceStatus;
  distance_message?: string;
  // Distance-proxy debug fields (0–1). skin_fill = largest skin blob over the
  // guide box; center_fill = how much of the guide's centre core that blob
  // covers (drives the verdict). Exposed for transparency; may be absent.
  skin_fill?: number;
  center_fill?: number;
  blob_texture?: number;
  blob_short_span?: number;
}

// POST /assess response.
export interface AssessResponse {
  status: Status;
  change_score: number;
  symptom_score: number;
  final_score: number;
  positive_symptoms: SymptomKey[];
  message_hindi: string;
  message_english: string;
  action: AssessAction;
  disclaimer_hindi: string;
  disclaimer_english: string;
  // Patient-friendly guidance (added by the backend; all optional for
  // backward compatibility — the Result screen renders without them). These
  // are English-only enrichment; the bilingual message_* fields stay canonical.
  patient_title?: string;
  patient_summary?: string;
  reason_summary?: string[];
  next_step?: string;
  care_level_label?: string;
  care_level_position?: number;
  visual_change_label?: string;
}

// One day's check-in inside GET /patient/<id>/history.
export interface HistoryEntry {
  date: string;
  photo_url: string;
  change_score: number;
  symptoms: Symptoms;
  symptom_score: number;
  final_score: number;
  status: Status;
  // Present on caregiver-submitted check-ins; older hardcoded entries omit them.
  // A submitted check-in is a before/today pair; photo_url stays = today_photo_url.
  submitted?: boolean;
  created_at?: string;
  checkin_id?: string;
  today_photo_url?: string | null;
  yesterday_photo_url?: string | null;
  // Advanced non-diagnostic visual metrics, only on submitted check-ins that
  // were analysed with /analyze-real. All optional for backward compatibility.
  redness_delta?: number;
  dark_area_delta?: number;
  yellow_area_delta?: number;
  wound_area_delta?: number;
  combined_border_change?: number;
}

// Doctor review actions (POST /patient/<id>/review). Next-step decisions plus
// optional guidance for the caregiver — never a diagnosis. Must match the
// backend's DOCTOR_ACTIONS set.
export type DoctorAction =
  | "continue_home_care"
  | "request_new_photo"
  | "recommend_clinic_visit"
  | "escalate_urgent_review";

// A saved doctor review, as returned in PatientHistory.latest_review and by the
// review endpoint.
export interface DoctorReview {
  review_id: string;
  patient_id: string;
  reviewed: boolean;
  doctor_action: DoctorAction;
  doctor_note: string | null;
  aftercare_instruction: string | null;
  reviewed_at: string;
  checkin_id?: string;
}

// GET /patient/<id>/history response.
export interface PatientHistory {
  id: string;
  name: string;
  age: number;
  gender: string;
  burn_location: string;
  burn_type: string;
  day_of_recovery: number;
  history: HistoryEntry[];
  // Latest doctor review for this patient, or null if none yet. Optional for
  // backward compatibility with older backends.
  latest_review?: DoctorReview | null;
}
