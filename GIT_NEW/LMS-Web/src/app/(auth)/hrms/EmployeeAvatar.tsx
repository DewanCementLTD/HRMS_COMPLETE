"use client";

import { useState, useEffect } from "react";
import { employeePhotoUrl } from "@/services/documentService";

function initials(name?: string) {
  const p = (name || "?").trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Shows the employee's uploaded photo, falling back to initials if none. */
export function EmployeeAvatar({
  empcode, adminCardNo, name, className = "", textClass = "text-2xl",
}: {
  empcode?: string; adminCardNo?: string; name?: string; className?: string; textClass?: string;
}) {
  const [err, setErr] = useState(false);
  useEffect(() => { setErr(false); }, [empcode]);
  const url = empcode && adminCardNo ? employeePhotoUrl(empcode, adminCardNo) : null;

  if (url && !err) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name || ""} onError={() => setErr(true)}
      className={`h-full w-full object-cover ${className}`} />;
  }
  return (
    <div className={`h-full w-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-extrabold ${textClass} ${className}`}>
      {initials(name)}
    </div>
  );
}
