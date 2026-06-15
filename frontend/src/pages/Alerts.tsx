import { BellRing, Phone, ShieldCheck, Stethoscope } from "lucide-react";
import { Card, ErrorState, Spinner } from "../components/common";
import { Disclaimer } from "../components/Disclaimer";
import { DoctorGuidanceCard } from "../components/DoctorGuidanceCard";
import { DoctorSyncNote } from "../components/DoctorSyncNote";
import { Layout } from "../components/Layout";
import { StatusBadge } from "../components/StatusBadge";
import { useCheckIn } from "../context/CheckInContext";
import type { CheckinSync } from "../context/CheckInContext";
import { useLanguage } from "../context/LanguageContext";
import { usePatientHistory } from "../hooks/usePatientHistory";
import type { AssessAction, Status } from "../types";

// Mirror the backend's red split so we can advise correctly when reading from
// stored history (which doesn't carry an action field).
function deriveAction(status: Status, finalScore: number): AssessAction {
  if (status === "red") return finalScore >= 75 ? "call_108" : "show_doctor_today";
  if (status === "amber") return "watch_closely";
  return "continue_care";
}

interface AlertView {
  status: Status;
  finalScore: number;
  changeScore: number;
  action: AssessAction;
}

export function Alerts() {
  const { tr, hiClass } = useLanguage();
  const { assessResult, checkinSync } = useCheckIn();
  const { data, loading, error, reload } = usePatientHistory();

  // Prefer the check-in just completed this session; otherwise the latest
  // stored check-in from the backend.
  let view: AlertView | null = null;
  if (assessResult) {
    view = {
      status: assessResult.status,
      finalScore: assessResult.final_score,
      changeScore: assessResult.change_score,
      action: assessResult.action,
    };
  } else if (data?.history.length) {
    const latest = data.history[data.history.length - 1];
    view = {
      status: latest.status,
      finalScore: latest.final_score,
      changeScore: latest.change_score,
      action: deriveAction(latest.status, latest.final_score),
    };
  }

  // Only block on the backend when we have nothing from context.
  const waitingOnBackend = !assessResult;

  return (
    <Layout>
      <div className="space-y-4">
        <div>
          <h1 className={`text-xl font-bold text-stone-800 ${hiClass}`}>
            {tr("Alerts", "अलर्ट")}
          </h1>
          <p className={`mt-1 text-sm text-stone-500 ${hiClass}`}>
            {tr("Status from the latest check-in.", "नवीनतम चेक-इन की स्थिति।")}
          </p>
        </div>

        <DoctorGuidanceCard review={data?.latest_review} />

        {waitingOnBackend && loading && <Spinner label={tr("Loading…", "लोड हो रहा है…")} />}

        {waitingOnBackend && !loading && error && !view && (
          <ErrorState
            title={tr("Couldn't load status", "स्थिति लोड नहीं हुई")}
            detail={error}
            onRetry={reload}
            retryLabel={tr("Try again", "फिर कोशिश करें")}
          />
        )}

        {view && <AlertBody view={view} sync={checkinSync} />}

        <Disclaimer />
      </div>
    </Layout>
  );
}

function AlertBody({ view, sync }: { view: AlertView; sync: CheckinSync }) {
  const { tr, hiClass } = useLanguage();
  const isRed = view.status === "red";
  const isAmber = view.status === "amber";

  return (
    <>
      {/* Current status hero */}
      <Card className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand/10 text-brand">
            <BellRing className="h-5 w-5" />
          </span>
          <div>
            <p className={`text-xs text-stone-400 ${hiClass}`}>{tr("Current status", "वर्तमान स्थिति")}</p>
            <div className="mt-1">
              <StatusBadge status={view.status} />
            </div>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl font-extrabold leading-none text-stone-800">{view.finalScore}</p>
          <p className={`text-[11px] text-stone-400 ${hiClass}`}>{tr("final score", "अंतिम स्कोर")}</p>
        </div>
      </Card>

      {/* Action needed */}
      {(isRed || isAmber) && (
        <Card className={isRed ? "border-l-4 border-l-red-500" : "border-l-4 border-l-amber-500"}>
          <p className={`mb-1 text-sm font-semibold text-stone-800 ${hiClass}`}>
            {tr("Action needed", "ज़रूरी कदम")}
          </p>
          {isRed && view.action === "call_108" ? (
            <>
              <p className={`text-sm text-stone-600 ${hiClass}`}>
                {tr(
                  "Call 108 immediately and take the patient to the nearest hospital.",
                  "तुरंत 108 पर कॉल करें और मरीज को नज़दीकी अस्पताल ले जाएँ।",
                )}
              </p>
              <a
                href="tel:108"
                className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-3 font-bold text-white active:scale-[0.99] ${hiClass}`}
              >
                <Phone className="h-5 w-5" />
                {tr("Call 108", "108 पर कॉल करें")}
              </a>
            </>
          ) : isRed ? (
            <p className={`flex items-start gap-2 text-sm text-stone-600 ${hiClass}`}>
              <Stethoscope className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              {tr("Show this to your doctor today.", "आज ही यह अपने डॉक्टर को दिखाएँ।")}
            </p>
          ) : (
            <p className={`text-sm text-stone-600 ${hiClass}`}>
              {tr(
                "Watch closely and show this to your doctor at the next visit.",
                "ध्यान से निगरानी रखें और अगली मुलाकात में डॉक्टर को दिखाएँ।",
              )}
            </p>
          )}
        </Card>
      )}

      {/* Green reassurance */}
      {!isRed && !isAmber && (
        <Card className="border-l-4 border-l-emerald-500">
          <p className={`flex items-start gap-2 text-sm text-stone-600 ${hiClass}`}>
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            {tr(
              "No significant change. Continue dressing care as advised.",
              "कोई महत्वपूर्ण बदलाव नहीं। सलाह के अनुसार ड्रेसिंग जारी रखें।",
            )}
          </p>
        </Card>
      )}

      {/* Latest scores */}
      <Card>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="rounded-xl bg-stone-50 px-3 py-2.5 text-center ring-1 ring-stone-100">
            <p className="text-lg font-bold text-stone-800">{view.changeScore}</p>
            <p className={`mt-0.5 text-[11px] text-stone-400 ${hiClass}`}>{tr("Change score", "बदलाव स्कोर")}</p>
          </div>
          <div className="rounded-xl bg-stone-50 px-3 py-2.5 text-center ring-1 ring-stone-100">
            <p className="text-lg font-bold text-stone-800">{view.finalScore}</p>
            <p className={`mt-0.5 text-[11px] text-stone-400 ${hiClass}`}>{tr("Final score", "अंतिम स्कोर")}</p>
          </div>
        </div>
      </Card>

      {/* Truthful doctor-portal note — only claims success when /checkins saved. */}
      <DoctorSyncNote sync={sync} />
    </>
  );
}
