"use client";

import { useState, useEffect } from "react";

const API_BASE = "/api";

export const companyLogoUrl = (compc: string | number, bust?: number | string) =>
  `${API_BASE}/documents/company-logo?compc=${encodeURIComponent(String(compc))}${bust ? `&t=${bust}` : ""}`;

/** Renders a company logo (object-contain so any colour/aspect shows). Renders
 * nothing if there's no logo for the company. */
export function CompanyLogo({
  compc, className = "", bust,
}: {
  compc?: string | number; className?: string; bust?: number | string;
}) {
  const [err, setErr] = useState(false);
  useEffect(() => { setErr(false); }, [compc, bust]);
  if (!compc || err) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={companyLogoUrl(compc, bust)} alt="" onError={() => setErr(true)} className={`object-contain ${className}`} />;
}
