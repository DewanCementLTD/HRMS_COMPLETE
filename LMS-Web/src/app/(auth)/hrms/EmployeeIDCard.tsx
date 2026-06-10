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
      <span className="text-[11px] font-medium text-gray-800 text-right truncate max-w-[58%]">{value || "—"}</span>
    </div>
  );
}

// ── Front face ──────────────────────────────────────────────
function CardFront({ c }: { c: EmployeeCard }) {
  return (
    <div className="w-full h-full rounded-2xl overflow-hidden bg-white border border-gray-200 shadow-lg flex flex-col">
      <div className="relative shrink-0 h-[180px] bg-gradient-to-br from-indigo-600 to-purple-600 flex items-start justify-center pt-5">
        <p className="text-white text-[13px] font-bold tracking-wide text-center px-3 leading-tight">
          {c.company_name || "Company"}
        </p>
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[-36px]">
          <div className="h-[72px] w-[72px] rounded-full bg-white p-1 shadow-md">
            <div className="h-full w-full rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-2xl font-extrabold">
              {initials(c.name)}
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col items-center px-4 pt-12 pb-4 text-center">
        <p className="text-[15px] font-extrabold text-gray-900 leading-tight">{c.name || "—"}</p>
        <p className="text-[11px] font-semibold text-indigo-600 mt-1">{c.designation || "—"}</p>
        {c.department && <p className="text-[10px] text-gray-400 mt-0.5">{c.department}</p>}
        <div className="mt-auto w-full">
          <div className="bg-gray-50 rounded-lg py-2 px-2">
            <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold">Card No</p>
            <p className="text-[14px] font-bold text-gray-900 font-mono">{c.card_no || c.empcode}</p>
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
      <div className="shrink-0 bg-gradient-to-r from-indigo-600 to-purple-600 py-2.5 text-center">
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
      <div className="shrink-0 border-t border-gray-100 py-2 text-center">
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 id-card-modal" onClick={onClose}>
      {/* Blur backdrop — a SEPARATE sibling so it never flattens the 3D card */}
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" />

      {/* Content sits in its own stacking context (not a backdrop-filter child) */}
      <div className="relative flex flex-col items-center gap-4" onClick={(e) => e.stopPropagation()}>
        <div className="id-card-screen" style={{ perspective: "1400px" }}>
          <div
            onClick={() => setFlipped((f) => !f)}
            title="Click to flip"
            style={{
              position: "relative",
              width: 320,
              height: 508,
              cursor: "pointer",
              transformStyle: "preserve-3d",
              transition: "transform 0.7s",
              transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
            }}
          >
            <div style={{ position: "absolute", inset: 0, WebkitBackfaceVisibility: "hidden", backfaceVisibility: "hidden" }}>
              <CardFront c={card} />
            </div>
            <div style={{ position: "absolute", inset: 0, WebkitBackfaceVisibility: "hidden", backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}>
              <CardBack c={card} />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 id-card-controls">
          <button onClick={() => setFlipped((f) => !f)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white text-gray-700 text-sm font-medium hover:bg-gray-100 shadow">
            <RotateCw className="h-4 w-4" /> Flip
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 shadow">
            <Printer className="h-4 w-4" /> Print
          </button>
          <button onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white text-gray-700 text-sm font-medium hover:bg-gray-100 shadow">
            <X className="h-4 w-4" /> Close
          </button>
        </div>
      </div>

      {/* Print-only layout: both faces at real card size */}
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
          .id-card-modal { position: static !important; display: block !important; padding: 0 !important; background: none !important; }
          .id-card-print { display: flex !important; flex-wrap: wrap; gap: 10mm; position: absolute; left: 0; top: 0; }
          .id-card-face { width: 54mm; height: 85.6mm; }
        }
      `}</style>
    </div>
  );
}
