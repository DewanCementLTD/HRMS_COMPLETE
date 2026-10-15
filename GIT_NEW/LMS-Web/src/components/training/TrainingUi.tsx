"use client";

import { Star, Check, X, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  REQUEST_STATUS_LABEL, SESSION_STATUS_LABEL, PARTICIPANT_STATUS_LABEL,
  type RequestStatus, type SessionStatus, type ParticipantStatus, type TrainingRequest,
} from "@/services/trainingService";

const TONE = {
  gray: "bg-gray-100 text-gray-600",
  blue: "bg-blue-50 text-blue-700",
  amber: "bg-amber-50 text-amber-700",
  green: "bg-emerald-50 text-emerald-700",
  red: "bg-red-50 text-red-600",
  indigo: "bg-indigo-50 text-indigo-700",
} as const;

export function Pill({ tone = "gray", children, className }: { tone?: keyof typeof TONE; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full text-[11px] font-semibold px-2 py-0.5 whitespace-nowrap", TONE[tone], className)}>
      {children}
    </span>
  );
}

const REQ_TONE: Record<RequestStatus, keyof typeof TONE> = {
  PENDING_HOD1: "amber", PENDING_HOD2: "amber", PENDING_HR: "blue", APPROVED: "indigo",
  BOOKED: "green", COMPLETED: "green", REJECTED: "red", CANCELLED: "gray",
};
export const RequestStatusPill = ({ status }: { status: RequestStatus }) => (
  <Pill tone={REQ_TONE[status]}>{REQUEST_STATUS_LABEL[status] ?? status}</Pill>
);

const SES_TONE: Record<SessionStatus, keyof typeof TONE> = {
  PLANNED: "gray", OPEN: "blue", IN_PROGRESS: "amber", COMPLETED: "green", CANCELLED: "red",
};
export const SessionStatusPill = ({ status }: { status: SessionStatus }) => (
  <Pill tone={SES_TONE[status]}>{SESSION_STATUS_LABEL[status] ?? status}</Pill>
);

const PART_TONE: Record<ParticipantStatus, keyof typeof TONE> = {
  BOOKED: "blue", COMPLETED: "green", FAILED: "red", NO_SHOW: "gray", WITHDRAWN: "gray",
};
export const ParticipantStatusPill = ({ status }: { status: ParticipantStatus }) => (
  <Pill tone={PART_TONE[status]}>{PARTICIPANT_STATUS_LABEL[status] ?? status}</Pill>
);

/** Read-only stars (supports decimals by rounding). */
export function Stars({ value, size = 14 }: { value: number | null | undefined; size?: number }) {
  if (value == null) return <span className="text-gray-400 text-xs">—</span>;
  const v = Math.round(value);
  return (
    <span className="inline-flex items-center gap-0.5" title={`${value} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} style={{ width: size, height: size }} className={i <= v ? "fill-amber-400 text-amber-400" : "text-gray-300"} />
      ))}
    </span>
  );
}

export function StarInput({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-gray-700">{label}</span>
      <span className="inline-flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <button key={i} type="button" onClick={() => onChange(i)} aria-label={`${i} star${i > 1 ? "s" : ""}`}>
            <Star className={cn("h-6 w-6 transition", i <= value ? "fill-amber-400 text-amber-400" : "text-gray-300 hover:text-amber-300")} />
          </button>
        ))}
      </span>
    </div>
  );
}

/** HOD 1 → HOD 2 → HR chain with each step's decision. */
export function ApprovalChain({ r }: { r: TrainingRequest }) {
  const steps: { label: string; a: TrainingRequest["hr"] | null; waiting: boolean }[] = [];
  if (r.hod1) steps.push({ label: "HOD 1", a: r.hod1, waiting: r.status === "PENDING_HOD1" });
  if (r.hod2) steps.push({ label: "HOD 2", a: r.hod2, waiting: r.status === "PENDING_HOD2" });
  steps.push({ label: "HR", a: r.hr, waiting: r.status === "PENDING_HR" });
  const closed = ["REJECTED", "CANCELLED"].includes(r.status);
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[11px]">
      {steps.map((st, i) => {
        const f = st.a?.flag;
        const icon = f === "Y" ? <Check className="h-3 w-3" /> : f === "N" ? <X className="h-3 w-3" /> : <Clock className="h-3 w-3" />;
        const tone = f === "Y" ? "text-emerald-700 bg-emerald-50" : f === "N" ? "text-red-600 bg-red-50"
          : st.waiting && !closed ? "text-amber-700 bg-amber-50" : "text-gray-400 bg-gray-50";
        return (
          <li key={st.label} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-gray-300">→</span>}
            <span className={cn("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium", tone)}
              title={[st.a?.name, st.a?.date, st.a?.remarks].filter(Boolean).join(" · ") || undefined}>
              {icon}{st.label}{st.a?.name ? `: ${st.a.name}` : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="p-2.5 rounded-lg bg-red-50 border border-red-100 text-sm text-red-600">{error}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-10 text-center text-sm text-gray-400">{children}</div>;
}

export function TextArea({ label, value, onChange, rows = 3, placeholder }: {
  label?: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}
      <textarea rows={rows} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
        className="w-full px-4 py-2.5 rounded-xl border border-gray-300 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent placeholder:text-gray-400 text-sm" />
    </div>
  );
}

/** Segmented tab bar in the style of the Provident Fund / HRMS pages. */
export function Tabs<T extends string>({ tabs, value, onChange, desc }: {
  tabs: { id: T; label: string; icon: React.ElementType; badge?: number }[];
  value: T; onChange: (t: T) => void; desc?: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-5">
      <div className="flex flex-wrap gap-1 p-1 bg-gray-100 rounded-xl">
        {tabs.map((t) => {
          const Icon = t.icon;
          const on = t.id === value;
          return (
            <button key={t.id} onClick={() => onChange(t.id)}
              className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-all",
                on ? "bg-white text-indigo-700 shadow-sm" : "text-gray-600 hover:text-gray-900")}>
              <Icon className="h-4 w-4" />
              {t.label}
              {!!t.badge && <span className="ml-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold px-1.5 leading-4">{t.badge}</span>}
            </button>
          );
        })}
      </div>
      {desc && <span className="text-xs text-gray-400 ml-auto hidden md:block">{desc}</span>}
    </div>
  );
}

export function SignInAgain() {
  return (
    <div className="py-10 text-center">
      <p className="font-semibold text-ink">Please sign in again</p>
      <p className="text-sm text-slate-500 mt-1">Your session is from an older login. Sign out and sign back in to use Training.</p>
    </div>
  );
}
