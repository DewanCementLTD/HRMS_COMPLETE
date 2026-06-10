"use client";

import { useState } from "react";
import { X, Printer, RotateCw } from "lucide-react";
import type { EmployeeCard } from "@/services/hrmsService";

function initials(name?: string) {
  const p = (name || "?").trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex justify-between gap-2 py-[3px] border-b border-gray-100 last:border-0">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
      <span className="text-[11px] font-medium text-gray-800 text-right truncate max-w-[60%]">{value || "—"}</span>
    </div>
  );
}

// ── Front face ──────────────────────────────────────────────
function CardFront({ c }: { c: EmployeeCard }) {
  return (
    <div className="w-full h-full rounded-2xl overflow-hidden bg-white border border-gray-200 shadow-lg flex flex-col">
      {/* Header band */}
      <div className="relative h-[38%] bg-gradient-to-br from-indigo-600 to-purple-600 flex items-start justify-center pt-4">
        <p className="text-white text-[13px] font-bold tracking-wide text-center px-3 leading-tight">
          {c.company_name || "Company"}
        </p>
        {/* Avatar */}
        <div className="absolute -bottom-9 left-1/2 -translate-x-1/2">
          <div className="h-[72px] w-[72px] rounded-full bg-white p-1 shadow-md">
            <div className="h-full w-full rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xl font-extrabold">
              {initials(c.name)}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col items-center px-4 pt-12 pb-3 text-center">
        <p className="text-[15px] font-extrabold text-gray-900 leading-tight">{c.name || "—"}</p>
        <p className="text-[11px] font-semibold text-indigo-600 mt-0.5">{c.designation || "—"}</p>
        {c.department && <p className="text-[10px] text-gray-400 mt-0.5">{c.department}</p>}

        <div className="mt-auto w-full">
          <div className="bg-gray-50 rounded-lg py-1.5 px-2">
            <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold">Card No</p>
            <p className="text-[13px] font-bold text-gray-900 font-mono">{c.card_no || c.empcode}</p>
          </div>
          <p className="mt-2 text-[8px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Employee ID Card</p>
        </div>
      </div>
    </div>
  );
}

// ── Back face ───────────────────────────────────────────────
function CardBack({ c }: { c: EmployeeCard }) {
  return (
    <div className="w-full h-full rounded-2xl overflow-hidden bg-white border border-gray-200 shadow-lg flex flex-col">
      <div className="bg-gradient-to-r from-indigo-600 to-purple-600 py-2 text-center">
        <p className="text-white text-[11px] font-bold uppercase tracking-wider">Employee Details</p>
      </div>
      <div className="flex-1 px-4 py-3">
        <Row label="Name" value={c.name} />
        <Row label="Card No" value={c.card_no || c.empcode} />
        <Row label="Designation" value={c.designation} />
        <Row label="CNIC" value={c.nicno} />
        <Row label="Phone" value={c.mobile} />
        <Row label="Department" value={c.department} />
        <Row label="Branch / Location" value={c.branch_name} />
        <Row label="Company" value={c.company_name} />
        {c.bldgrp && <Row label="Blood Group" value={c.bldgrp} />}
        {c.dtofappt && <Row label="Joined" value={c.dtofappt} />}
      </div>
      <div className="border-t border-gray-100 py-2 text-center">
        <p className="text-[9px] text-gray-400">
          Powered by <span className="font-semibold text-indigo-500">hrms.sysnovix.com</span>
        </p>
      </div>
    </div>
  );
}

export function EmployeeIDCard({ card, onClose }: { card: EmployeeCard; onClose: () => void }) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 id-card-modal">
      <div className="flex flex-col items-center gap-4">
        {/* Interactive flip card (screen only) */}
        <div className="id-card-screen" style={{ perspective: "1400px" }}>
          <div
            className="relative cursor-pointer transition-transform duration-700"
            style={{
              width: 320,
              height: 508,
              transformStyle: "preserve-3d",
              transform: flipped ? "rotateY(180deg)" : "none",
            }}
            onClick={() => setFlipped((f) => !f)}
            title="Click to flip"
          >
            <div className="absolute inset-0" style={{ backfaceVisibility: "hidden" }}>
              <CardFront c={card} />
            </div>
            <div className="absolute inset-0" style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
              <CardBack c={card} />
            </div>
          </div>
        </div>

        {/* Controls (screen only) */}
        <div className="flex items-center gap-2 id-card-controls">
          <button onClick={() => setFlipped((f) => !f)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/90 text-gray-700 text-sm font-medium hover:bg-white shadow">
            <RotateCw className="h-4 w-4" /> Flip
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 shadow">
            <Printer className="h-4 w-4" /> Print
          </button>
          <button onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/90 text-gray-700 text-sm font-medium hover:bg-white shadow">
            <X className="h-4 w-4" /> Close
          </button>
        </div>
      </div>

      {/* Print-only layout: both faces at card size */}
      <div className="id-card-print">
        <div className="id-card-face"><CardFront c={card} /></div>
        <div className="id-card-face"><CardBack c={card} /></div>
      </div>

      <style>{`
        .id-card-print { display: none; }
        @media print {
          @page { margin: 12mm; }
          body * { visibility: hidden !important; }
          .id-card-print, .id-card-print * { visibility: visible !important; }
          .id-card-screen, .id-card-controls { display: none !important; }
          .id-card-modal { position: static !important; background: none !important; backdrop-filter: none !important; display: block !important; padding: 0 !important; }
          .id-card-print { display: flex !important; flex-wrap: wrap; gap: 10mm; position: absolute; left: 0; top: 0; }
          .id-card-face { width: 54mm; height: 85.6mm; }
        }
      `}</style>
    </div>
  );
}
