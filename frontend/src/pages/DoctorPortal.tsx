import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  HeartPulse,
  ImageOff,
  Info,
  LineChart,
  MapPin,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Stethoscope,
  User,
} from "lucide-react";
import {
  DOCTOR_ACTION_OPTIONS,
  fetchPatientHistory,
  fetchPatients,
  formatDate,
  formatDateTime,
  genderLabel,
  priorityLabel,
  resolvePhotoUrl,
  STATUS_RANK,
  submitReview,
  symptomLabels,
  type DoctorAction,
  type DoctorHistoryEntry,
  type DoctorReview,
  type PatientDetail,
  type PatientSummary,
  type TriageStatus,
} from "../lib/doctor-api";
import { buildPhotoTimeline, entryKey, entryLabel, entryMeta, type TimelinePhoto } from "../lib/timeline";

type Filter = "all" | TriageStatus;

const STATUS_BADGE: Record<TriageStatus, string> = {
  red: "border-red-200 bg-red-50 text-red-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

const STATUS_DOT: Record<TriageStatus, string> = {
  red: "bg-red-500",
  amber: "bg-amber-500",
  green: "bg-emerald-500",
};

const STATUS_BAR: Record<TriageStatus, string> = {
  red: "bg-red-500",
  amber: "bg-amber-500",
  green: "bg-emerald-500",
};

const STATUS_LABEL: Record<TriageStatus, string> = {
  red: "High change",
  amber: "Some change",
  green: "Low change",
};

function DoctorStatusBadge({ status }: { status: TriageStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${STATUS_BADGE[status]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
      {STATUS_LABEL[status]}
    </span>
  );
}

function PriorityPill({ status }: { status: TriageStatus }) {
  return (
    <span className={`rounded-md border px-2 py-1 text-[11px] font-semibold ${STATUS_BADGE[status]}`}>
      {priorityLabel(status)}
    </span>
  );
}

// Both hooks refetch when `refreshTick` changes (manual refresh or polling).
// Background refreshes keep the current data on screen — no skeleton flicker —
// and only surface an error when there is nothing to show, so polling is quiet.
function usePatients(refreshTick: number) {
  const [data, setData] = useState<PatientSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hasData = useRef(false);

  useEffect(() => {
    let active = true;
    fetchPatients()
      .then((patients) => {
        if (!active) return;
        setData(patients);
        hasData.current = true;
        setError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        // Keep stale data visible on a background refresh failure.
        if (!hasData.current) {
          setError(err instanceof Error ? err.message : "Could not reach backend");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshTick]);

  return { data, error, loading };
}

function usePatientDetail(id: string | null, refreshTick: number) {
  const [data, setData] = useState<PatientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lastId = useRef<string | null>(null);

  useEffect(() => {
    if (!id) {
      setData(null);
      setError(null);
      lastId.current = null;
      return;
    }

    const idChanged = lastId.current !== id;
    lastId.current = id;
    let active = true;
    // Skeleton only when switching patients; a same-patient background refresh
    // (refreshTick change) keeps the current detail on screen.
    if (idChanged) {
      setLoading(true);
      setData(null);
      setError(null);
    }
    fetchPatientHistory(id)
      .then((detail) => {
        if (active) {
          setData(detail);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (active && idChanged) {
          setError(err instanceof Error ? err.message : "Could not load patient history");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id, refreshTick]);

  return { data, error, loading };
}

export function DoctorPortal() {
  const [refreshTick, setRefreshTick] = useState(0);
  // One refresh drives both the list and the selected patient detail.
  const refresh = useCallback(() => setRefreshTick((tick) => tick + 1), []);
  const { data: patients, error, loading } = usePatients(refreshTick);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  // Lightweight polling so newly submitted check-ins surface without a manual
  // refresh. Quiet by design (background refresh, no skeletons). Not websockets.
  useEffect(() => {
    const interval = window.setInterval(refresh, 15000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!selectedId && patients && patients.length > 0) {
      const sorted = [...patients].sort((a, b) => {
        const risk = STATUS_RANK[a.last_status] - STATUS_RANK[b.last_status];
        if (risk !== 0) return risk;
        return b.last_check_in.localeCompare(a.last_check_in);
      });
      setSelectedId(sorted[0].id);
    }
  }, [patients, selectedId]);

  const counts = useMemo(() => {
    const tally: Record<TriageStatus, number> = { red: 0, amber: 0, green: 0 };
    (patients ?? []).forEach((patient) => {
      tally[patient.last_status] += 1;
    });
    return tally;
  }, [patients]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return (patients ?? [])
      .filter((patient) => filter === "all" || patient.last_status === filter)
      .filter(
        (patient) =>
          !normalizedQuery ||
          patient.name.toLowerCase().includes(normalizedQuery) ||
          patient.burn_location.toLowerCase().includes(normalizedQuery),
      )
      .sort((a, b) => {
        const risk = STATUS_RANK[a.last_status] - STATUS_RANK[b.last_status];
        if (risk !== 0) return risk;
        return b.last_check_in.localeCompare(a.last_check_in);
      });
  }, [patients, query, filter]);

  return (
    <div className="min-h-screen bg-stone-100 text-stone-800">
      <header className="sticky top-0 z-20 border-b border-stone-200 bg-cream/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3 md:px-6 md:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-white shadow-card">
              <Stethoscope className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-extrabold tracking-tight text-stone-900 md:text-lg">
                <span className="text-brand">GharSehat</span> · Doctor Review Portal
              </h1>
              <p className="text-xs text-stone-500">Silent triage view for caregiver check-ins</p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <CountChip tone="red" label="Red" value={counts.red} />
            <CountChip tone="amber" label="Amber" value={counts.amber} />
            <CountChip tone="green" label="Green" value={counts.green} />
            <div className="ml-1 hidden border-l border-stone-200 pl-3 text-[11px] text-stone-500 md:block">
              Last updated {formatDateTime()}
            </div>
            <button
              type="button"
              onClick={refresh}
              className="grid h-8 w-8 place-items-center rounded-lg text-stone-500 transition hover:bg-white hover:text-brand"
              aria-label="Refresh patients"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <Link
              to="/home"
              className="hidden rounded-lg bg-white px-3 py-2 text-xs font-semibold text-stone-600 ring-1 ring-stone-200 transition hover:text-brand md:inline-flex"
            >
              Caregiver app
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-4 py-4 md:px-6 md:py-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_1fr] lg:gap-6">
          <aside className={`${selectedId ? "hidden lg:block" : "block"} space-y-3`}>
            <DoctorCard className="space-y-3 p-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search name or burn location"
                  className="w-full rounded-xl border border-stone-200 bg-white py-2.5 pl-9 pr-3 text-sm text-stone-700 outline-none transition placeholder:text-stone-400 focus:border-brand/40 focus:ring-4 focus:ring-brand/10"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(["all", "red", "amber", "green"] as const).map((item) => {
                  const active = filter === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setFilter(item)}
                      className={`rounded-full border px-3 py-1.5 text-[11px] font-bold transition ${
                        active
                          ? "border-brand bg-brand text-white"
                          : "border-stone-200 bg-white text-stone-600 hover:border-brand/30 hover:text-brand"
                      }`}
                    >
                      {item === "all" ? "All" : item[0].toUpperCase() + item.slice(1)}
                    </button>
                  );
                })}
              </div>
            </DoctorCard>

            {loading && <ListSkeleton />}
            {error && !loading && <ErrorBox title="Could not reach backend" detail={error} onRetry={refresh} />}
            {!loading && !error && filtered.length === 0 && (
              <DoctorCard className="border-dashed px-5 py-8 text-center">
                <p className="text-sm font-semibold text-stone-800">No patients found</p>
                <p className="mt-1 text-xs text-stone-500">Try a different search or filter.</p>
              </DoctorCard>
            )}
            {!loading && !error && filtered.length > 0 && (
              <ul className="space-y-2">
                {filtered.map((patient) => (
                  <li key={patient.id}>
                    <PatientListButton
                      patient={patient}
                      selected={selectedId === patient.id}
                      onSelect={() => setSelectedId(patient.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </aside>

          <section className={selectedId ? "block" : "hidden lg:block"}>
            <DetailPanel
              selectedId={selectedId}
              refreshTick={refreshTick}
              onBack={() => setSelectedId(null)}
              onRefresh={refresh}
            />
          </section>
        </div>

        <p className="pb-6 pt-8 text-center text-[11px] text-stone-500">
          Not a medical diagnosis. Always use clinical judgment and patient evaluation.
        </p>
      </main>
    </div>
  );
}

function PatientListButton({
  patient,
  selected,
  onSelect,
}: {
  patient: PatientSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl border bg-white p-3 text-left shadow-card transition hover:border-brand/40 hover:shadow-lg ${
        selected ? "border-brand/60 ring-4 ring-brand/10" : "border-stone-100"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-stone-900">{patient.name}</p>
          <p className="mt-0.5 text-[11px] text-stone-500">
            {patient.age} · {genderLabel(patient.gender)} · Day {patient.day_of_recovery}
          </p>
        </div>
        <DoctorStatusBadge status={patient.last_status} />
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-stone-500">
        <MapPin className="h-3 w-3 shrink-0" />
        <span className="truncate">{patient.burn_location}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <PriorityPill status={patient.last_status} />
        <span className="text-[11px] text-stone-500">Check-in {formatDate(patient.last_check_in)}</span>
      </div>
    </button>
  );
}

function DetailPanel({
  selectedId,
  refreshTick,
  onBack,
  onRefresh,
}: {
  selectedId: string | null;
  refreshTick: number;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const { data, loading, error } = usePatientDetail(selectedId, refreshTick);

  if (!selectedId) {
    return (
      <DoctorCard className="border-dashed px-8 py-14 text-center">
        <Stethoscope className="mx-auto h-8 w-8 text-stone-400" />
        <p className="mt-3 text-sm font-semibold text-stone-800">Select a patient to review</p>
        <p className="mt-1 text-xs text-stone-500">Priority is sorted: red first, then amber, then green.</p>
      </DoctorCard>
    );
  }

  if (loading) return <DetailSkeleton onBack={onBack} />;

  if (error) {
    return (
      <div className="space-y-3">
        <BackBar onBack={onBack} />
        <ErrorBox title="Could not load patient history" detail={error} onRetry={onRefresh} />
      </div>
    );
  }

  if (!data) return null;

  const latest = data.history.at(-1);
  const previous = data.history.length > 1 ? data.history[data.history.length - 2] : null;
  const currentStatus = latest?.status ?? "green";
  const maxScore = Math.max(100, ...data.history.map((entry) => entry.final_score));
  const finalDelta = latest && previous ? Math.round(latest.final_score - previous.final_score) : 0;

  return (
    <div className="space-y-4">
      <BackBar onBack={onBack} />

      <DoctorCard className="p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-stone-100 text-stone-500">
              <User className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-extrabold text-stone-900">{data.name}</h2>
              <p className="mt-0.5 text-xs text-stone-500">
                {data.age} years · {genderLabel(data.gender)} · Day {data.day_of_recovery} of recovery
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-700">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-stone-400" />
                  {data.burn_location}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Activity className="h-3.5 w-3.5 text-stone-400" />
                  {data.burn_type}
                </span>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <DoctorStatusBadge status={currentStatus} />
            <PriorityPill status={currentStatus} />
          </div>
        </div>
      </DoctorCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <MetricCard
          icon={<LineChart className="h-4 w-4" />}
          label="Latest final score"
          value={latest ? latest.final_score.toString() : "-"}
          detail={finalDelta > 0 ? `+${finalDelta} from previous check-in` : `${finalDelta} from previous check-in`}
          tone={currentStatus}
        />
        <MetricCard
          icon={<Activity className="h-4 w-4" />}
          label="Visual change score"
          value={latest ? latest.change_score.toString() : "-"}
          detail="Photo-to-photo comparison"
          tone={currentStatus}
        />
        <MetricCard
          icon={<CalendarDays className="h-4 w-4" />}
          label="Latest check-in"
          value={latest ? formatDate(latest.created_at ?? latest.date) : "-"}
          detail="Caregiver submitted timeline"
          tone={currentStatus}
        />
      </div>

      <DoctorCard className="p-4 md:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-stone-900">5-day score trend</h3>
            <p className="mt-0.5 text-[11px] text-stone-500">
              Final score combines visual change and caregiver symptom checklist.
            </p>
          </div>
          <div className="hidden items-center gap-3 text-[11px] text-stone-500 sm:flex">
            <LegendDot tone="green" label="Green" />
            <LegendDot tone="amber" label="Amber" />
            <LegendDot tone="red" label="Red" />
          </div>
        </div>
        <TrendChart history={data.history} max={maxScore} />
      </DoctorCard>

      <DoctorCard className="p-4 md:p-5">
        <h3 className="mb-3 text-sm font-bold text-stone-900">Recovery timeline</h3>
        <div className="-mx-1 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-stone-400">
                <th className="px-2 py-2 font-bold">Day</th>
                <th className="px-2 py-2 font-bold">Date</th>
                <th className="px-2 py-2 font-bold">Status</th>
                <th className="px-2 py-2 text-right font-bold">Change</th>
                <th className="px-2 py-2 text-right font-bold">Symptoms</th>
                <th className="px-2 py-2 text-right font-bold">Final</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((entry, index) => (
                <tr
                  key={entryKey(entry, index)}
                  className={`border-t border-stone-100 ${
                    index === data.history.length - 1 ? "bg-stone-50/80" : ""
                  }`}
                >
                  <td className="px-2 py-3 font-semibold text-stone-800">
                    {entryLabel(entryMeta(data.history, index)).en}
                  </td>
                  <td className="px-2 py-3 text-stone-500">{formatDate(entry.created_at ?? entry.date)}</td>
                  <td className="px-2 py-3">
                    <DoctorStatusBadge status={entry.status} />
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums text-stone-700">{entry.change_score}</td>
                  <td className="px-2 py-3 text-right tabular-nums text-stone-700">{entry.symptom_score}</td>
                  <td className="px-2 py-3 text-right font-bold tabular-nums text-stone-900">
                    {entry.final_score}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DoctorCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <DoctorCard className="p-4 md:p-5">
          <h3 className="mb-3 text-sm font-bold text-stone-900">Wound photos</h3>
          <div className="grid grid-cols-5 gap-2">
            {buildPhotoTimeline(data.history).map((photo) => (
              <PhotoThumb key={photo.key} photo={photo} />
            ))}
          </div>
        </DoctorCard>

        <DoctorCard className="p-4 md:p-5">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-sm font-bold text-stone-900">Latest symptoms</h3>
            {latest && <span className="text-[11px] text-stone-500">{formatDate(latest.date)}</span>}
          </div>
          <ul className="space-y-1.5">
            {symptomLabels().map(({ key, label }) => {
              const reported = latest?.symptoms[key] ?? false;
              return (
                <li
                  key={key}
                  className="flex items-center justify-between rounded-xl border border-stone-100 px-3 py-2 text-sm"
                >
                  <span className="text-stone-700">{label}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${
                      reported
                        ? "border-red-200 bg-red-50 text-red-700"
                        : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    }`}
                  >
                    {reported ? "Reported" : "Clear"}
                  </span>
                </li>
              );
            })}
          </ul>
        </DoctorCard>
      </div>

      {latest && <AdvancedPhotoAnalysis entry={latest} />}

      <DoctorReviewPanel
        key={data.id}
        patientId={data.id}
        checkinId={latest?.checkin_id}
        latestReview={data.latest_review}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex gap-3 rounded-2xl border border-sky-100 bg-sky-50 p-4">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
          <div className="text-[13px] leading-relaxed text-sky-900">
            <p className="font-bold">How review priority is set</p>
            <p className="mt-1">
              Priority is based on visual change between consecutive photos and the caregiver-reported
              symptom checklist. The portal updates silently for later review.
            </p>
          </div>
        </div>

        <div className="flex gap-3 rounded-2xl border border-stone-200 bg-white p-4">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-stone-500" />
          <p className="text-[12px] leading-relaxed text-stone-500">
            This view summarizes caregiver check-ins only. Use your clinical judgment and a patient
            evaluation before any treatment decision.
          </p>
        </div>
      </div>
    </div>
  );
}

// Map a non-diagnostic visual metric (0-100) to a human-readable severity.
// Higher = more visual area change. Never a diagnosis.
function severityLabel(value: number | undefined): { label: string; tone: TriageStatus } {
  if (value == null || value <= 0) return { label: "Low", tone: "green" };
  if (value >= 60) return { label: "High", tone: "red" };
  if (value >= 30) return { label: "Medium", tone: "amber" };
  return { label: "Mild", tone: "amber" };
}

/**
 * Collapsed "Advanced photo analysis" section for the selected patient.
 *
 * Shows non-diagnostic visual-area severity labels derived from the latest
 * submitted check-in's /analyze-real metrics. Renders nothing when no such
 * metrics were saved (older / mock-analyze check-ins). Uses a native
 * <details> so it is collapsed by default and needs no extra state. Shows
 * severity words only — never raw pixel counts or debug data.
 */
function AdvancedPhotoAnalysis({ entry }: { entry: DoctorHistoryEntry }) {
  const rows = [
    { label: "Red visual area", value: entry.redness_delta },
    { label: "Dark visual area", value: entry.dark_area_delta },
    { label: "Yellow/cream visual area", value: entry.yellow_area_delta },
    { label: "Approx. visual-region change", value: entry.wound_area_delta },
    { label: "Combined border change", value: entry.combined_border_change },
  ];
  // Only render when at least one advanced metric was actually saved.
  if (rows.every((row) => row.value == null)) return null;

  return (
    <DoctorCard className="p-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-4 md:p-5">
          <span className="text-sm font-bold text-stone-900">Advanced photo analysis</span>
          <span className="text-stone-400 transition-transform group-open:rotate-180" aria-hidden>▾</span>
        </summary>
        <div className="space-y-2 px-4 pb-4 md:px-5 md:pb-5">
          <ul className="space-y-1.5">
            {rows.map((row) => {
              const { label, tone } = severityLabel(row.value);
              return (
                <li
                  key={row.label}
                  className="flex items-center justify-between rounded-xl border border-stone-100 px-3 py-2 text-sm"
                >
                  <span className="text-stone-700">{row.label}</span>
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${STATUS_BADGE[tone]}`}>
                    {label}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-stone-500">Non-diagnostic visual features for doctor review.</p>
        </div>
      </details>
    </DoctorCard>
  );
}

// True when an ISO timestamp falls on the local calendar's today.
function isToday(iso: string): boolean {
  const date = new Date(iso);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

/**
 * Doctor review / action panel for the selected patient.
 *
 * Lets the doctor record a next-step action plus optional free-text note and
 * aftercare instruction, persisted via POST /patient/<id>/review. It links to
 * the latest check-in when one exists. Records a decision only — never a
 * diagnosis. Remounted per patient (keyed on id) so state never leaks across
 * patients.
 */
function DoctorReviewPanel({
  patientId,
  checkinId,
  latestReview,
}: {
  patientId: string;
  checkinId?: string;
  latestReview?: DoctorReview | null;
}) {
  const [action, setAction] = useState<DoctorAction>(
    latestReview?.doctor_action ?? "continue_home_care",
  );
  const [note, setNote] = useState("");
  const [aftercare, setAftercare] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState<DoctorReview | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Newest review to display: the one just saved this session, else the one
  // loaded from history. Drives the "Reviewed today" state and survives reload.
  const effectiveLatest = saved ?? latestReview ?? null;
  const reviewedToday = effectiveLatest ? isToday(effectiveLatest.reviewed_at) : false;

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitReview({
        patientId,
        doctorAction: action,
        doctorNote: note.trim() || undefined,
        aftercareInstruction: aftercare.trim() || undefined,
        checkinId,
      });
      setSaved(result.review);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save review");
    } finally {
      setSubmitting(false);
    }
  }

  const textareaClass =
    "mt-1 w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700 outline-none transition placeholder:text-stone-400 focus:border-brand/40 focus:ring-4 focus:ring-brand/10";

  return (
    <DoctorCard className="p-4 md:p-5">
      <div className="mb-1 flex items-center gap-2">
        <ClipboardList className="h-4 w-4 text-brand" />
        <h3 className="text-sm font-bold text-stone-900">Doctor review &amp; action</h3>
      </div>
      <p className="mb-3 text-[11px] text-stone-500">
        Record your next step and optional guidance for the caregiver. This is a review decision, not a diagnosis.
      </p>

      {effectiveLatest && (
        <div className="mb-3 rounded-xl border border-stone-200 bg-stone-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-stone-400">Last review</span>
            {reviewedToday ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                Reviewed today
              </span>
            ) : (
              <span className="text-[11px] text-stone-400">{formatDate(effectiveLatest.reviewed_at)}</span>
            )}
          </div>
          <p className="mt-1 text-sm font-bold text-stone-800">
            {DOCTOR_ACTION_OPTIONS.find((option) => option.value === effectiveLatest.doctor_action)?.label ??
              effectiveLatest.doctor_action}
          </p>
          {effectiveLatest.doctor_note && (
            <p className="mt-1 text-[13px] text-stone-600">{effectiveLatest.doctor_note}</p>
          )}
          {effectiveLatest.aftercare_instruction && (
            <p className="mt-1 text-[13px] text-stone-600">
              <span className="font-semibold text-stone-500">Aftercare: </span>
              {effectiveLatest.aftercare_instruction}
            </p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {DOCTOR_ACTION_OPTIONS.map((option) => {
          const active = action === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setAction(option.value)}
              className={`rounded-xl border px-3 py-2 text-left text-sm font-semibold transition ${
                active
                  ? "border-brand bg-brand/5 text-brand ring-2 ring-brand/20"
                  : "border-stone-200 bg-white text-stone-600 hover:border-brand/40"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <label className="mt-3 block text-[11px] font-bold uppercase tracking-wide text-stone-400">
        Doctor note (optional)
      </label>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={2}
        placeholder="e.g. Please upload a clearer photo tomorrow in natural light."
        className={textareaClass}
      />

      <label className="mt-3 block text-[11px] font-bold uppercase tracking-wide text-stone-400">
        Aftercare instruction (optional)
      </label>
      <textarea
        value={aftercare}
        onChange={(event) => setAftercare(event.target.value)}
        rows={2}
        placeholder="e.g. Continue dressing care as advised at discharge."
        className={textareaClass}
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded-xl bg-brand px-4 py-2 text-sm font-bold text-white shadow-card transition hover:opacity-90 disabled:opacity-60"
        >
          <Send className="h-4 w-4" />
          {submitting ? "Saving…" : "Save review"}
        </button>
        {checkinId ? (
          <span className="text-[11px] text-stone-400">Linked to latest check-in</span>
        ) : (
          <span className="text-[11px] text-stone-400">Not linked to a specific check-in</span>
        )}
      </div>

      {saved && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-[13px] text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-bold">Review saved</p>
            <p className="mt-0.5">
              {DOCTOR_ACTION_OPTIONS.find((option) => option.value === saved.doctor_action)?.label} ·{" "}
              {formatDate(saved.reviewed_at)}
            </p>
          </div>
        </div>
      )}
      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-[13px] text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}
    </DoctorCard>
  );
}

function DoctorCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-stone-100 bg-white shadow-card ${className}`}>{children}</div>;
}

function CountChip({ tone, label, value }: { tone: TriageStatus; label: string; value: number }) {
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-bold ${STATUS_BADGE[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[tone]}`} />
      {label}
      <span className="tabular-nums opacity-80">{value}</span>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: TriageStatus;
}) {
  return (
    <DoctorCard className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">{label}</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-stone-900">{value}</p>
          <p className="mt-1 text-[11px] text-stone-500">{detail}</p>
        </div>
        <span className={`grid h-8 w-8 place-items-center rounded-xl ${STATUS_BADGE[tone]}`}>{icon}</span>
      </div>
    </DoctorCard>
  );
}

function LegendDot({ tone, label }: { tone: TriageStatus; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${STATUS_DOT[tone]}`} />
      {label}
    </span>
  );
}

function TrendChart({ history, max }: { history: DoctorHistoryEntry[]; max: number }) {
  return (
    <div className="flex h-40 items-end gap-2">
      {history.map((entry, index) => {
        const percent = Math.max(7, Math.round((entry.final_score / max) * 100));
        return (
          <div key={entryKey(entry, index)} className="flex h-full flex-1 flex-col items-center gap-1.5">
            <div className="text-[10px] tabular-nums text-stone-500">{entry.final_score}</div>
            <div className="relative flex w-full flex-1 items-end overflow-hidden rounded-lg bg-stone-100">
              <div
                className={`w-full rounded-lg ${STATUS_BAR[entry.status]} transition-all`}
                style={{ height: `${percent}%` }}
              />
            </div>
            <div className="text-[10px] font-semibold text-stone-500">
              {entryLabel(entryMeta(history, index)).en}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PhotoThumb({ photo }: { photo: TimelinePhoto }) {
  const [failed, setFailed] = useState(false);
  const source = resolvePhotoUrl(photo.url);
  const showImage = source && !failed;
  const label = photo.labelEn;

  return (
    <div
      className={`relative aspect-square overflow-hidden rounded-xl border bg-stone-100 ${
        photo.status === "red"
          ? "border-red-200"
          : photo.status === "amber"
            ? "border-amber-200"
            : "border-emerald-200"
      }`}
      title={`${label} · ${STATUS_LABEL[photo.status]}`}
    >
      {showImage ? (
        <img
          src={source}
          alt={`Wound photo ${label}`}
          className="h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className={`flex h-full w-full flex-col items-center justify-center gap-1 text-stone-500 ${
            photo.status === "red"
              ? "bg-red-50"
              : photo.status === "amber"
                ? "bg-amber-50"
                : "bg-emerald-50"
          }`}
        >
          <ImageOff className="h-4 w-4 opacity-70" />
          <span className="text-[10px] font-bold">{label}</span>
        </div>
      )}
      <span className={`absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${STATUS_DOT[photo.status]}`} />
    </div>
  );
}

function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-stone-500 transition hover:text-brand lg:hidden"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to patient list
    </button>
  );
}

function ErrorBox({
  title,
  detail,
  onRetry,
}: {
  title: string;
  detail?: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-red-800">{title}</p>
        {detail && <p className="mt-1 break-words text-xs text-red-700">{detail}</p>}
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-red-700 hover:underline"
        >
          <RefreshCw className="h-3 w-3" />
          Retry
        </button>
      </div>
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="space-y-2">
      {Array.from({ length: 4 }).map((_, index) => (
        <li key={index} className="animate-pulse rounded-2xl border border-stone-100 bg-white p-3 shadow-card">
          <div className="mb-2 h-3 w-1/2 rounded bg-stone-100" />
          <div className="mb-3 h-2.5 w-1/3 rounded bg-stone-100" />
          <div className="h-2.5 w-2/3 rounded bg-stone-100" />
        </li>
      ))}
    </ul>
  );
}

function DetailSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      <BackBar onBack={onBack} />
      <div className="animate-pulse rounded-2xl border border-stone-100 bg-white p-5 shadow-card">
        <div className="mb-3 h-4 w-1/3 rounded bg-stone-100" />
        <div className="mb-2 h-3 w-1/2 rounded bg-stone-100" />
        <div className="h-3 w-1/4 rounded bg-stone-100" />
      </div>
      <div className="h-48 animate-pulse rounded-2xl border border-stone-100 bg-white p-5 shadow-card" />
      <div className="h-40 animate-pulse rounded-2xl border border-stone-100 bg-white p-5 shadow-card" />
    </div>
  );
}

export function DoctorPortalMiniLink() {
  return (
    <Link
      to="/doctor"
      className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs font-bold text-brand shadow-card ring-1 ring-rose-100"
    >
      <HeartPulse className="h-4 w-4" />
      Doctor portal
    </Link>
  );
}
