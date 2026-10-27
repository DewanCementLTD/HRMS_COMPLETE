import { clsx, type ClassValue } from "clsx";

export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

// Fixed locale so amounts always read 50,000 (never the browser's own
// grouping such as 50.000 or 5,00,000).
const NUMBER_LOCALE = "en-US";

/** Number with thousands separators, e.g. 50000 -> "50,000". */
export function formatNumber(
  v: number | string | null | undefined,
  { maxDecimals = 2, minDecimals = 0, fallback = "—" }: { maxDecimals?: number; minDecimals?: number; fallback?: string } = {}
): string {
  if (v === null || v === undefined || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString(NUMBER_LOCALE, { minimumFractionDigits: minDecimals, maximumFractionDigits: Math.max(minDecimals, maxDecimals) });
}

/** Adds separators to a raw typed number string ("-1234.5" -> "-1,234.5"), keeping the decimals as typed. */
export function groupDigits(raw: string): string {
  const m = /^(-?)(\d*)(\.\d*)?$/.exec(raw.replace(/,/g, ""));
  if (!m) return raw;
  const [, sign, int, dec = ""] = m;
  return sign + int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + dec;
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function getStatusColor(status: string): string {
  switch (status?.toUpperCase()) {
    case "APPROVED":
      return "bg-emerald-100 text-emerald-800";
    case "PENDING":
      return "bg-amber-100 text-amber-800";
    case "REJECTED":
      return "bg-red-100 text-red-800";
    case "CANCELLED":
      return "bg-gray-100 text-gray-600";
    case "PRESENT":
      return "bg-emerald-100 text-emerald-800";
    case "ABSENT":
      return "bg-red-100 text-red-800";
    case "LATE":
      return "bg-yellow-100 text-yellow-800";
    case "HALF DAY":
      return "bg-orange-100 text-orange-800";
    case "INCOMPLETE":
      return "bg-amber-100 text-amber-800";
    case "LEAVE":
      return "bg-blue-100 text-blue-800";
    case "OFF":
    case "WEEKLY OFF":
      return "bg-gray-100 text-gray-500";
    default:
      return "bg-gray-100 text-gray-600";
  }
}

// Row background tint for an attendance status: late = yellow, absent = red,
// half day = orange. Returns "" for neutral statuses (present / off).
export function getAttendanceRowTint(status?: string): string {
  switch (status?.toUpperCase()) {
    case "LATE":
      return "bg-yellow-50 hover:bg-yellow-100/70";
    case "ABSENT":
      return "bg-red-50 hover:bg-red-100/70";
    case "HALF DAY":
      return "bg-orange-50 hover:bg-orange-100/70";
    default:
      return "";
  }
}

/**
 * 'YYYY-MM-DD' for a date in the VIEWER'S timezone.
 *
 * `toISOString().split("T")[0]` converts to UTC first, so east of Greenwich a
 * local midnight lands on the previous day — in Pakistan (UTC+5) the first of
 * the month was being sent as the 31st, and before 05:00 "today" was sent as
 * yesterday. Every date range handed to the API must be built with this.
 */
export function toLocalYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
