import { AlertCircle, Camera, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BottomNav } from "../components/BottomNav";
import { CTAButton } from "../components/CTAButton";
import { ErrorState, Spinner } from "../components/common";
import { Disclaimer } from "../components/Disclaimer";
import { DoctorGuidanceCard } from "../components/DoctorGuidanceCard";
import { LanguageSelector } from "../components/LanguageSelector";
import { ProgressBar } from "../components/ProgressBar";
import { useCheckIn } from "../context/CheckInContext";
import { useLanguage } from "../context/LanguageContext";
import { resolvePhotoUrl } from "../lib/photos";
import { STATUS_META } from "../lib/status";
import { buildPhotoTimeline, type TimelinePhoto } from "../lib/timeline";
import { usePatientHistory } from "../hooks/usePatientHistory";
import type { PatientHistory } from "../types";

function capitalize(text: string): string {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export function Home() {
  const navigate = useNavigate();
  const { tr, hiClass } = useLanguage();
  const { reset } = useCheckIn();
  // Single source of truth: usePatientHistory defaults to DEMO_PATIENT_ID, the
  // same id used by /capture, /symptoms, /progress, /alerts, and POST /checkins.
  const { data, loading, error, reload } = usePatientHistory();

  function startCheckIn() {
    reset();
    navigate("/capture");
  }

  return (
    <div className="flex min-h-screen justify-center bg-stone-100">
      <div className="relative flex min-h-screen w-full max-w-md flex-col bg-white pb-16 shadow-sm">
        <main className="flex-1 px-5 pb-4 pt-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-brand">GharSehat</h1>
              <p className={`mt-1 text-sm leading-snug text-slate-500 ${hiClass}`}>
                {data
                  ? tr(
                      `Namaste, ${data.name} ji — Day ${data.day_of_recovery} of recovery`,
                      `नमस्ते, ${data.name} जी — स्वस्थ होने का दिन ${data.day_of_recovery}`,
                    )
                  : tr("Namaste — your recovery companion", "नमस्ते — आपका रिकवरी साथी")}
              </p>
            </div>
            <div className="shrink-0">
              <LanguageSelector />
            </div>
          </div>

          <div className="mt-6 space-y-5">
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-900" />
              <div>
                <p className={`text-sm font-semibold text-amber-950 ${hiClass}`}>
                  {tr("Daily check-in due", "आज की जाँच बाकी है")}
                </p>
                <p className={`mt-0.5 text-xs text-amber-900/80 ${hiClass}`}>
                  {tr("takes 2 minutes", "केवल 2 मिनट लगते हैं")}
                </p>
              </div>
            </div>

            {loading && (
              <Spinner label={tr("Loading your recovery…", "आपकी रिकवरी लोड हो रही है…")} />
            )}

            {!loading && error && (
              <ErrorState
                title={tr("Couldn't load your details", "आपका विवरण लोड नहीं हो सका")}
                detail={error}
                onRetry={reload}
                retryLabel={tr("Try again", "फिर कोशिश करें")}
              />
            )}

            {!loading && !error && data && <HomeBody data={data} onStartCheckIn={startCheckIn} />}

            <CTAButton onClick={startCheckIn} className={`mt-2 ${hiClass}`}>
              {tr("Start today's check-in", "आज की जाँच शुरू करें")}
            </CTAButton>
          </div>
        </main>

        <Disclaimer className="px-5 pb-4 pt-2" />
        <BottomNav />
      </div>
    </div>
  );
}

function HomeBody({
  data,
  onStartCheckIn,
}: {
  data: PatientHistory;
  onStartCheckIn: () => void;
}) {
  const { tr, hiClass } = useLanguage();
  const latest = data.history[data.history.length - 1];
  const first = data.history[0];
  const meta = STATUS_META[latest.status];
  const improving = latest.final_score < first.final_score;

  // Photo-history tiles from the shared timeline. A submitted check-in renders
  // as a Before/Today pair (not duplicate "Today" tiles); the last few photos
  // are shown.
  const recent = buildPhotoTimeline(data.history).slice(-3);

  return (
    <>
      <DoctorGuidanceCard review={data.latest_review} />

      <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-card">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className={`text-xs font-semibold uppercase tracking-wide text-slate-500 ${hiClass}`}>
              {tr("Wound", "घाव")}
            </p>
            <p className="mt-0.5 text-sm font-semibold text-slate-950">
              {capitalize(data.burn_location)} — {data.burn_type}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${meta.soft}`}
          >
            {tr(meta.labelEn, meta.labelHi)}
          </span>
        </div>

        <div className="mt-5 space-y-4">
          <ProgressBar
            label={tr("Healing trend", "स्वस्थ होने की प्रवृत्ति")}
            value={latest.final_score}
            tone={latest.status}
            badge={
              improving
                ? tr("Improving", "सुधार हो रहा है")
                : tr("Needs attention", "ध्यान चाहिए")
            }
          />
          <ProgressBar
            label={tr("Last change", "पिछला बदलाव")}
            value={latest.change_score}
            tone={latest.status}
            badge={tr(meta.labelEn, meta.labelHi)}
          />
        </div>
      </div>

      <div>
        <p className={`mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 ${hiClass}`}>
          {tr("Photo history", "फोटो इतिहास")}
        </p>

        <div className="grid grid-cols-4 gap-2">
          {recent.map((photo) => (
            <PhotoHistoryTile key={photo.key} photo={photo} />
          ))}

          <button
            type="button"
            onClick={onStartCheckIn}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-brand/40 text-brand hover:bg-brand/5 active:scale-[0.99]"
          >
            <Plus className="h-[18px] w-[18px]" />
            <span className={`text-[10px] font-medium ${hiClass}`}>{tr("New", "नई")}</span>
          </button>
        </div>
      </div>
    </>
  );
}

// One photo-history tile. Renders the real check-in photo when its resolved
// URL loads; on a missing/broken image it falls back to the camera placeholder.
// Failure state is per-tile so one broken image doesn't blank the others.
function PhotoHistoryTile({ photo }: { photo: TimelinePhoto }) {
  const { tr, hiClass } = useLanguage();
  const [failed, setFailed] = useState(false);
  const statusMeta = STATUS_META[photo.status];
  const src = resolvePhotoUrl(photo.url);
  const showImage = Boolean(src) && !failed;
  const caption = tr(photo.labelEn, photo.labelHi);

  return (
    <div
      className="relative aspect-square overflow-hidden rounded-lg bg-slate-100"
      title={tr(statusMeta.labelEn, statusMeta.labelHi)}
    >
      {showImage ? (
        <>
          <img
            src={src}
            alt={caption}
            onError={() => setFailed(true)}
            className="h-full w-full object-cover"
          />
          <span className={`absolute inset-x-0 bottom-0 bg-black/45 py-0.5 text-center text-[10px] font-semibold text-white ${hiClass}`}>
            {caption}
          </span>
        </>
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1">
          <Camera className="h-[18px] w-[18px] text-slate-500" />
          <span className={`text-[10px] font-medium text-slate-500 ${hiClass}`}>{caption}</span>
        </div>
      )}
      <span className={`absolute right-1 top-1 h-2 w-2 rounded-full ring-2 ring-white ${statusMeta.dot}`} />
    </div>
  );
}
