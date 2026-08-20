"use client";

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Printer, RotateCw } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { EmployeeCard } from "@/services/hrmsService";
import { EmployeeAvatar } from "./EmployeeAvatar";
import { CompanyLogo } from "@/components/ui/CompanyLogo";

// Sysnovix brand gradient — used for the headers and the card-no chip so the
// card isn't a plain white sheet. printColorAdjust keeps it on paper too.
const BRAND_GRADIENT = "linear-gradient(135deg, #4338ca 0%, #6d28d9 50%, #0ea5e9 100%)";
const SYSNOVIX_URL = "https://sysnovix.com";
const PRINT_COLOR = { printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" } as const;

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex items-start justify-between gap-2 py-[5px] border-b border-indigo-100 last:border-0">
      <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-500 shrink-0 pt-px">{label}</span>
      <span className="text-[12.5px] font-bold text-slate-900 text-right leading-snug">{value || "—"}</span>
    </div>
  );
}

// ── Front face ──────────────────────────────────────────────
export function CardFront({ c, adminCardNo }: { c: EmployeeCard; adminCardNo?: string }) {
  return (
    <div
      className="w-full h-full rounded-2xl overflow-hidden bg-white border border-indigo-200 shadow-xl flex flex-col text-center"
      style={PRINT_COLOR}
    >
      {/* Gradient header — logo sits on a white chip so transparent logos stay visible.
          Extra bottom padding leaves room for the company name to clear the
          overlapping photo below. */}
      <div className="px-4 pt-4 pb-16" style={{ background: BRAND_GRADIENT, ...PRINT_COLOR }}>
        <div className="mx-auto inline-flex items-center justify-center bg-white rounded-xl px-3 py-1.5 shadow-md">
          <CompanyLogo compc={c.compc} className="h-[52px] max-w-[170px]" />
        </div>
        <p className="text-white text-[15px] font-extrabold tracking-wide mt-2 leading-tight">
          {c.company_name || "Company"}
        </p>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col px-4 pb-4">
        {/* Photo overlaps the header band */}
        <div
          className="mx-auto h-[128px] w-[128px] rounded-full overflow-hidden ring-4 ring-white bg-white -mt-12"
          style={{ boxShadow: "0 8px 20px rgba(67,56,202,0.28)" }}
        >
          <EmployeeAvatar empcode={c.empcode} adminCardNo={adminCardNo} name={c.name} textClass="text-5xl" />
        </div>

        <p className="text-[21px] font-extrabold text-slate-900 leading-tight mt-3">{c.name || "—"}</p>
        <p className="text-[13px] font-bold text-indigo-700 mt-1 uppercase tracking-wide">{c.designation || "—"}</p>
        {c.department && <p className="text-[12px] font-semibold text-slate-600 mt-0.5">{c.department}</p>}

        <div className="mt-auto w-full">
          <div className="rounded-xl py-2.5 px-2 text-white shadow-md" style={{ background: BRAND_GRADIENT, ...PRINT_COLOR }}>
            <p className="text-[9px] uppercase tracking-wider font-bold opacity-90">Card No</p>
            <p className="text-[21px] font-extrabold font-mono leading-tight">{c.card_no || c.empcode}</p>
          </div>
          <p className="mt-2.5 text-[9px] uppercase tracking-[0.25em] text-indigo-400 font-bold">Employee ID Card</p>
        </div>
      </div>
    </div>
  );
}

// ── Back face ───────────────────────────────────────────────
export function CardBack({ c }: { c: EmployeeCard }) {
  return (
    <div
      className="w-full h-full rounded-2xl overflow-hidden bg-white border border-indigo-200 shadow-xl flex flex-col"
      style={PRINT_COLOR}
    >
      {/* Gradient header */}
      <div className="px-4 py-3 text-center" style={{ background: BRAND_GRADIENT, ...PRINT_COLOR }}>
        <p className="text-white text-[14px] font-extrabold uppercase tracking-[0.15em]">Employee Details</p>
        <p className="text-white/90 text-[10.5px] font-semibold mt-0.5 truncate">{c.company_name || ""}</p>
      </div>

      <div className="flex-1 px-4 pt-2">
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

      {/* QR to the Sysnovix website + company footer */}
      <div className="mt-auto px-3 pb-3 pt-2">
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: "#eef2ff", ...PRINT_COLOR }}>
          <div className="bg-white p-1.5 rounded-lg shrink-0 shadow-sm">
            <QRCodeSVG value={SYSNOVIX_URL} size={62} level="M" fgColor="#1e1b4b" bgColor="#ffffff" />
          </div>
          <div className="text-left leading-tight">
            <p className="text-[13px] font-extrabold text-indigo-700">Sysnovix</p>
            <p className="text-[9.5px] text-slate-600 font-semibold">ERP &amp; IT Solutions</p>
            <p className="text-[9px] text-slate-500 mt-0.5">Scan to visit sysnovix.com</p>
          </div>
        </div>
        <p className="text-center text-[7.5px] text-slate-500 font-medium leading-snug mt-2 px-1">
          © 2026 Sysnovix | ERP &amp; IT Solutions | 📞 +92 370 3677800 | ✉️ info@sysnovix.com | 🌐 sysnovix.com
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
          /* Keep the brand gradient / colored panels on paper */
          .id-card-print * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
    </div>
  );

  return createPortal(modal, document.body);
}
