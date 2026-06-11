"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { QRCodeSVG } from "qrcode.react";
import { X, Printer, RotateCw } from "lucide-react";
import type { EmployeeCard } from "@/services/hrmsService";
import { EmployeeAvatar } from "./EmployeeAvatar";

const SITE_URL = "https://hrms.sysnovix.com";

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-start justify-between gap-2 py-[5px] border-b border-gray-100 last:border-0">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400 shrink-0 pt-px">{label}</span>
      <span className="text-[11px] font-semibold text-gray-800 text-right leading-snug">{value || "—"}</span>
    </div>
  );
}

// ── Front face ──────────────────────────────────────────────
export function CardFront({ c, adminCardNo }: { c: EmployeeCard; adminCardNo?: string }) {
  return (
    <div className="w-full h-full rounded-2xl overflow-hidden bg-white border border-gray-200 shadow-xl flex flex-col">
      <div className="relative shrink-0 h-[176px] bg-gradient-to-br from-indigo-600 via-indigo-600 to-purple-600 flex items-start justify-center pt-5">
        <p className="text-white text-[13px] font-bold tracking-wide text-center px-3 leading-tight">
          {c.company_name || "Company"}
        </p>
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[-38px]">
          <div className="h-[76px] w-[76px] rounded-full bg-white p-1 shadow-lg ring-2 ring-white">
            <div className="h-full w-full rounded-full overflow-hidden">
              <EmployeeAvatar empcode={c.empcode} adminCardNo={adminCardNo} name={c.name} />
            </div>
          </div>
        </div>
      </div>
      <div className="flex-1 flex flex-col items-center px-4 pt-12 pb-4 text-center">
        <p className="text-[16px] font-extrabold text-gray-900 leading-tight">{c.name || "—"}</p>
        <p className="text-[11px] font-bold text-indigo-600 mt-1 uppercase tracking-wide">{c.designation || "—"}</p>
        {c.department && <p className="text-[10px] text-gray-400 mt-0.5">{c.department}</p>}
        <div className="mt-auto w-full">
          <div className="bg-indigo-50 rounded-xl py-2 px-2 border border-indigo-100">
            <p className="text-[8px] uppercase tracking-wider text-indigo-400 font-bold">Card No</p>
            <p className="text-[15px] font-extrabold text-indigo-700 font-mono">{c.card_no || c.empcode}</p>
          </div>
          <p className="mt-2.5 text-[8px] uppercase tracking-[0.25em] text-gray-400 font-bold">Employee ID Card</p>
        </div>
      </div>
    </div>
  );
}

// ── Back face ───────────────────────────────────────────────
export function CardBack({ c }: { c: EmployeeCard }) {
  return (
    <div className="w-full h-full rounded-2xl overflow-hidden bg-white border border-gray-200 shadow-xl flex flex-col">
      <div className="shrink-0 bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-3 text-center">
        <p className="text-white text-[12px] font-bold uppercase tracking-[0.15em]">Employee Details</p>
        <p className="text-indigo-100 text-[9px] mt-0.5 truncate">{c.company_name || ""}</p>
      </div>

      <div className="flex-1 px-4 py-2.5 flex flex-col">
        <div>
          <Row label="Name" value={c.name} />
          <Row label="Card No" value={c.card_no || c.empcode} />
          <Row label="Designation" value={c.designation} />
          <Row label="CNIC" value={c.nicno} />
          <Row label="Phone" value={c.mobile} />
          <Row label="Department" value={c.department} />
          <Row label="Branch" value={c.branch_name} />
          {c.bldgrp && <Row label="Blood Group" value={c.bldgrp} />}
          {c.dtofappt && <Row label="Joined" value={c.dtofappt} />}
        </div>

        {/* QR — centered at the bottom middle */}
        <div className="mt-auto flex flex-col items-center pt-3">
          <div className="p-1.5 bg-white rounded-lg border border-gray-200 shadow-sm">
            <QRCodeSVG value={SITE_URL} size={68} level="M" />
          </div>
          <p className="text-[7px] text-gray-400 mt-1 text-center leading-tight">Scan to visit hrms.sysnovix.com</p>
        </div>
      </div>

      <div className="shrink-0 bg-gradient-to-r from-indigo-600 to-purple-600 py-1.5 text-center">
        <p className="text-[9px] text-white/90">
          Powered by <span className="font-bold">hrms.sysnovix.com</span>
        </p>
      </div>
    </div>
  );
}

export function EmployeeIDCard({ card, onClose, adminCardNo }: { card: EmployeeCard; onClose: () => void; adminCardNo?: string }) {
  const [flipped, setFlipped] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const modal = (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 id-card-modal" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm id-card-backdrop" />

      <div className="relative flex flex-col items-center gap-4 id-card-content" onClick={(e) => e.stopPropagation()}>
        <div className="id-card-screen" style={{ width: 320, height: 508 }}>
          <div
            key={flipped ? "back" : "front"}
            onClick={() => setFlipped((f) => !f)}
            title="Click to flip"
            style={{ width: "100%", height: "100%", cursor: "pointer", animation: "idflip 0.4s ease" }}
          >
            {flipped ? <CardBack c={card} /> : <CardFront c={card} adminCardNo={adminCardNo} />}
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

      {/* Print-only layout — each face rendered at its design size (320x508) and
          scaled down as a whole, so nothing is clipped. */}
      <div className="id-card-print">
        <div className="id-card-face"><div className="id-card-scale"><CardFront c={card} adminCardNo={adminCardNo} /></div></div>
        <div className="id-card-face"><div className="id-card-scale"><CardBack c={card} /></div></div>
      </div>

      <style>{`
        @keyframes idflip {
          0%   { transform: rotateY(90deg); opacity: 0; }
          100% { transform: rotateY(0deg);  opacity: 1; }
        }
        .id-card-print { display: none; }
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          /* Collapse the whole app so it doesn't print blank pages */
          body > *:not(.id-card-modal) { display: none !important; }
          .id-card-modal {
            position: static !important; inset: auto !important; display: block !important;
            background: none !important; backdrop-filter: none !important;
            -webkit-backdrop-filter: none !important; padding: 0 !important; z-index: auto !important;
          }
          .id-card-backdrop, .id-card-content { display: none !important; }
          .id-card-print { display: flex !important; flex-wrap: wrap; gap: 8mm; align-items: flex-start; }
          /* CR80 card: 54mm x 85.6mm. Inner is the full design (320x508) scaled to fit. */
          .id-card-face {
            width: 54mm; height: 85.6mm; overflow: hidden; box-shadow: none !important;
          }
          .id-card-scale {
            width: 320px; height: 508px;
            transform: scale(0.6367);         /* 508px -> 85.6mm (323.5px @96dpi) */
            transform-origin: top left;
          }
          .id-card-scale > div { box-shadow: none !important; }
        }
      `}</style>
    </div>
  );

  return createPortal(modal, document.body);
}
