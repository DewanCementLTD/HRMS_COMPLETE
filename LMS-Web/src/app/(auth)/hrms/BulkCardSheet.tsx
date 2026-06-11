"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Printer, X } from "lucide-react";
import type { EmployeeCard } from "@/services/hrmsService";
import { CardFront, CardBack } from "./EmployeeIDCard";

function Face({ children }: { children: React.ReactNode }) {
  return (
    <div className="bulk-face">
      <div className="bulk-scale">{children}</div>
    </div>
  );
}

/** Full-screen sheet that previews and prints many ID cards at CR80 size. */
export function BulkCardSheet({
  cards,
  onClose,
  includeBack = true,
  adminCardNo,
}: {
  cards: EmployeeCard[];
  onClose: () => void;
  includeBack?: boolean;
  adminCardNo?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const sheet = (
    <div className="fixed inset-0 z-[1000] bg-slate-900/70 overflow-auto bulk-card-modal">
      <div className="bulk-card-toolbar sticky top-0 z-10 flex items-center gap-3 px-4 py-3 bg-white shadow">
        <Printer className="h-5 w-5 text-indigo-600" />
        <span className="font-semibold text-gray-900">{cards.length} card{cards.length > 1 ? "s" : ""} ready to print</span>
        <span className="text-xs text-gray-400">CR80 — 54 × 85.6 mm</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700">
            <Printer className="h-4 w-4" /> Print
          </button>
          <button onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200">
            <X className="h-4 w-4" /> Close
          </button>
        </div>
      </div>

      <div className="bulk-card-grid flex flex-wrap gap-4 justify-center p-6">
        {cards.map((c) => (
          <Face key={`f-${c.empcode}`}><CardFront c={c} adminCardNo={adminCardNo} /></Face>
        ))}
        {includeBack && cards.map((c) => (
          <Face key={`b-${c.empcode}`}><CardBack c={c} /></Face>
        ))}
      </div>

      <style>{`
        .bulk-face { width: 54mm; height: 85.6mm; overflow: hidden; background: #fff; }
        .bulk-scale { width: 320px; height: 508px; transform: scale(0.6367); transform-origin: top left; }
        @media print {
          @page { size: A4 portrait; margin: 8mm; }
          body > *:not(.bulk-card-modal) { display: none !important; }
          .bulk-card-modal {
            position: static !important; inset: auto !important; display: block !important;
            background: none !important; overflow: visible !important;
          }
          .bulk-card-toolbar { display: none !important; }
          .bulk-card-grid { gap: 6mm !important; padding: 0 !important; justify-content: flex-start !important; }
          .bulk-face { box-shadow: none !important; }
          .bulk-scale > div { box-shadow: none !important; }
        }
      `}</style>
    </div>
  );

  return createPortal(sheet, document.body);
}
