import { Stethoscope } from "lucide-react";
import { useLanguage } from "../context/LanguageContext";
import type { DoctorAction, DoctorReview, Status } from "../types";

// Caregiver-friendly bilingual label + urgency tone for each doctor action.
// These relay the doctor's chosen next step — never a diagnosis.
const ACTION_LABEL: Record<DoctorAction, { en: string; hi: string; tone: Status }> = {
  continue_home_care: { en: "Continue home care", hi: "घरेलू देखभाल जारी रखें", tone: "green" },
  request_new_photo: { en: "Doctor requested a new photo", hi: "डॉक्टर ने नई फोटो माँगी है", tone: "amber" },
  recommend_clinic_visit: { en: "Visit the clinic", hi: "क्लिनिक ज़रूर जाएँ", tone: "amber" },
  escalate_urgent_review: { en: "Urgent review needed", hi: "तत्काल जाँच ज़रूरी है", tone: "red" },
};

const TONE_CARD: Record<Status, string> = {
  green: "border-emerald-200 bg-emerald-50",
  amber: "border-amber-200 bg-amber-50",
  red: "border-red-200 bg-red-50",
};
const TONE_TEXT: Record<Status, string> = {
  green: "text-emerald-800",
  amber: "text-amber-900",
  red: "text-red-800",
};

function formatReviewDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  } catch {
    return iso;
  }
}

/**
 * Caregiver-facing card showing the doctor's latest review: the action plus any
 * note and aftercare instruction. Renders nothing when no review exists. It
 * relays the doctor's guidance only — it is not a diagnosis. The doctor's own
 * free text (note/aftercare) is shown as written and is not translated.
 */
export function DoctorGuidanceCard({ review }: { review?: DoctorReview | null }) {
  const { tr, hiClass } = useLanguage();
  if (!review) return null;

  const action = ACTION_LABEL[review.doctor_action];
  const tone: Status = action?.tone ?? "amber";

  return (
    <div className={`rounded-xl border p-4 shadow-card ${TONE_CARD[tone]}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/70 ${TONE_TEXT[tone]}`}>
          <Stethoscope className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <p className={`text-xs font-bold uppercase tracking-wide ${TONE_TEXT[tone]} ${hiClass}`}>
              {tr("Doctor's guidance", "डॉक्टर की सलाह")}
            </p>
            <span className="shrink-0 text-[11px] text-stone-500">{formatReviewDate(review.reviewed_at)}</span>
          </div>
          <p className={`mt-1 text-sm font-bold text-stone-900 ${hiClass}`}>
            {action ? tr(action.en, action.hi) : review.doctor_action}
          </p>
          {review.doctor_note && <p className="mt-1.5 text-sm text-stone-700">{review.doctor_note}</p>}
          {review.aftercare_instruction && (
            <div className="mt-2 rounded-lg bg-white/70 px-3 py-2">
              <p className={`text-[11px] font-bold uppercase tracking-wide text-stone-400 ${hiClass}`}>
                {tr("Aftercare", "देखभाल")}
              </p>
              <p className="mt-0.5 text-sm text-stone-700">{review.aftercare_instruction}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
