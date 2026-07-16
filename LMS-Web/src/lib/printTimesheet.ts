import { AttendanceRecord, AttendanceSummary } from "@/models/attendance";

export interface PrintEmployeeInfo {
  name?: string;
  empcode?: string;
  card_no?: string;
  atdtcard?: string;
  dept_no?: string;
  desg_cd?: string;
  mobile?: string;
  status?: string;
  emp_name?: string;   // used by employee self-view
  emp_no?: string;
  designation?: string;
  department?: string;
}

function fmtPrintDate(d: string): string {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  const day = String(dt.getDate()).padStart(2, "0");
  const mon = dt.toLocaleString("en-US", { month: "short" }).toUpperCase();
  const yr = String(dt.getFullYear()).slice(2);
  return `${day}-${mon}-${yr}`;
}

function fmtHM(h: number | undefined, m: number | undefined): string {
  if (!h && !m) return "";
  return `${h ?? 0}:${String(m ?? 0).padStart(2, "0")}`;
}

function getRowBg(rec: AttendanceRecord): string {
  // Colour by the ERP roster status: late = yellow, absent = red, half day = orange.
  const s = (rec.status || "").toUpperCase();
  if (s === "LATE") return "#fff3b0";       // yellow
  if (s === "HALF DAY") return "#ffe0b2";   // orange
  if (s === "ABSENT") return "#ffcccc";     // red
  const day = (rec.day_name || "").toUpperCase();
  const isWeekend = day === "SATURDAY" || day === "SUNDAY";
  if (isWeekend && !rec.in_time) return "#e0e0e0";
  if (rec.in_time && !rec.out_time) return "#ffff99";
  return "#ffffff";
}

const STATUS_LABEL: Record<string, string> = {
  A: "ACTIVE", I: "INACTIVE", D: "INACTIVE", L: "LEFT",
};

function escHtml(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function printTimesheetWindow(
  emp: PrintEmployeeInfo,
  records: AttendanceRecord[],
  summary: AttendanceSummary | null,
  fromDate: string,
  toDate: string,
  mode: "print" | "view" = "print",
  companyName?: string,
) {
  const runTime = new Date().toLocaleString("en-US", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const empName = emp.name || emp.emp_name || "";
  const empCode = emp.empcode || emp.emp_no || "";
  const cardNo  = emp.card_no || emp.atdtcard || "—";
  const dept    = emp.dept_no || emp.department || "—";
  const desg    = emp.desg_cd || emp.designation || "—";
  const mobile  = emp.mobile || "—";
  const status  = STATUS_LABEL[emp.status || ""] || emp.status || "—";

  const rowsHtml = records.map((rec) => {
    const bg = getRowBg(rec);
    const isWeekend = ["SATURDAY", "SUNDAY"].includes((rec.day_name || "").toUpperCase());
    const isLate    = !!rec.is_late;
    const isHalf    = !!rec.is_half_day;
    const shiftBg  = isWeekend && !rec.in_time ? "#555555" : bg;
    const shiftColor = isWeekend && !rec.in_time ? "#ffffff" : "#000000";

    return `
      <tr style="background:${bg}">
        <td style="font-weight:500">${fmtPrintDate(rec.roster_date)}</td>
        <td style="background:${shiftBg};color:${shiftColor};font-weight:bold;text-align:center">${rec.roster_shift || "G"}</td>
        <td style="text-align:left">${rec.day_name || "—"}</td>
        <td style="color:${isLate ? "#b45309" : "#000"};font-weight:${isLate ? "bold" : "normal"}">${rec.in_time || ""}</td>
        <td>${rec.out_time || ""}</td>
        <td>${rec.in_time ? fmtHM(rec.w_hrs, rec.w_mnt) : ""}</td>
        <td style="color:#b45309;font-weight:${isLate ? "bold" : "normal"}">${isLate ? "Late" : ""}</td>
        <td style="color:#c2410c;font-weight:${isHalf ? "bold" : "normal"}">${isHalf ? "Half Day" : ""}</td>
        <td>${rec.status || ""}</td>
        <td style="text-align:left;font-style:italic;color:#555">${rec.roster_remarks || ""}</td>
      </tr>`;
  }).join("");

  const summaryHtml = summary ? `
    <table class="summary-table">
      <thead>
        <tr>
          <th>Total Days</th><th>Present</th><th>Absent</th>
          <th>Incomplete</th><th>Late</th><th>Half Day</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${summary.total_days}</td>
          <td style="color:#006400;font-weight:bold">${summary.present}</td>
          <td style="color:#cc0000;font-weight:bold">${summary.absent_days}</td>
          <td style="color:#996600">${summary.incomplete}</td>
          <td style="color:#b45309;font-weight:bold">${summary.late_days ?? 0}</td>
          <td style="color:#c2410c;font-weight:bold">${summary.half_days ?? 0}</td>
        </tr>
      </tbody>
    </table>` : "";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escHtml([(companyName || "").trim(), "Time Sheet", empName].filter(Boolean).join(" - "))}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }

    html, body {
      font-family: Arial, sans-serif;
      font-size: 10px;
      color: #000;
      background: #fff;
    }

    @page {
      size: A4 landscape;
      margin: 10mm 8mm;
    }

    .page {
      width: 100%;
      padding: 0;
    }

    /* ── Header ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      border-bottom: 3px solid #1a1a1a;
      padding-bottom: 6px;
      margin-bottom: 10px;
    }
    .header-left { display: flex; align-items: center; gap: 10px; }
    .header-left img { height: 36px; width: auto; object-fit: contain; }
    .header-title { font-size: 16px; font-weight: bold; letter-spacing: 0.3px; }
    .header-subtitle { font-size: 12px; font-weight: bold; margin-top: 1px; }
    .header-right { font-size: 9px; color: #555; text-align: right; }

    /* ── Employee Info ── */
    .emp-table {
      width: 100%;
      border-collapse: collapse;
      border: 1px solid #aaa;
      margin-bottom: 8px;
      font-size: 10px;
    }
    .emp-table td {
      padding: 3px 7px;
      border-right: 1px solid #ccc;
    }
    .emp-table tr + tr { border-top: 1px solid #ccc; }
    .emp-table td:last-child { border-right: none; }
    .emp-table b { font-weight: 600; }

    /* ── Main data table ── */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9.5px;
      margin-bottom: 8px;
      table-layout: fixed;
    }
    .data-table th {
      padding: 4px 5px;
      border: 1px solid #aaa;
      background: #4472C4;
      color: #fff;
      text-align: center;
      white-space: nowrap;
      font-weight: 600;
    }
    .data-table td {
      padding: 2.5px 5px;
      border: 1px solid #ddd;
      text-align: center;
      vertical-align: middle;
    }
    /* Column widths */
    .data-table col.c-date   { width: 7.5%; }
    .data-table col.c-shift  { width: 4.5%; }
    .data-table col.c-day    { width: 9%; }
    .data-table col.c-in     { width: 7%; }
    .data-table col.c-out    { width: 7%; }
    .data-table col.c-whrs   { width: 8%; }
    .data-table col.c-late   { width: 8%; }
    .data-table col.c-ot     { width: 7%; }
    .data-table col.c-status { width: 10%; }
    .data-table col.c-rem    { width: auto; }

    tr { page-break-inside: avoid; }

    /* ── Summary ── */
    .summary-table {
      border-collapse: collapse;
      font-size: 9.5px;
      margin-bottom: 8px;
    }
    .summary-table th {
      padding: 4px 14px;
      border: 1px solid #aaa;
      background: #d9d9d9;
      color: #000;
      font-weight: 600;
      text-align: center;
    }
    .summary-table td {
      padding: 3px 14px;
      border: 1px solid #ddd;
      text-align: center;
    }

    /* ── Legend ── */
    .legend {
      display: flex;
      gap: 14px;
      font-size: 8.5px;
      color: #555;
      margin-top: 4px;
    }
    .legend-item { display: flex; align-items: center; gap: 4px; }
    .legend-box {
      width: 11px; height: 11px;
      border: 1px solid #aaa;
      display: inline-block;
      flex-shrink: 0;
    }
  </style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="header-left">
      <img src="/LMS_Black.png" alt="Logo" onerror="this.style.display='none'">
      <div>
        <div class="header-title">${escHtml((companyName || "").trim() || "Leave Management System")}</div>
        <div class="header-subtitle">Time Sheet</div>
      </div>
    </div>
    <div class="header-right">Report run on:&nbsp;&nbsp;${runTime}</div>
  </div>

  <table class="emp-table">
    <tbody>
      <tr>
        <td width="28%"><b>Name :</b>&nbsp; ${empName}</td>
        <td width="18%"><b>Card No :</b>&nbsp; ${cardNo}</td>
        <td width="18%"><b>Emp # :</b>&nbsp; ${empCode}</td>
        <td><b>Department :</b>&nbsp; ${dept}</td>
      </tr>
      <tr>
        <td><b>From :</b>&nbsp; ${fmtPrintDate(fromDate)}&nbsp;&nbsp;&nbsp;<b>To :</b>&nbsp; ${fmtPrintDate(toDate)}</td>
        <td><b>Designation :</b>&nbsp; ${desg}</td>
        <td><b>Status :</b>&nbsp; ${status}</td>
        <td><b>Mobile :</b>&nbsp; ${mobile}</td>
      </tr>
    </tbody>
  </table>

  <table class="data-table">
    <colgroup>
      <col class="c-date"><col class="c-shift"><col class="c-day">
      <col class="c-in"><col class="c-out"><col class="c-whrs">
      <col class="c-late"><col class="c-ot"><col class="c-status"><col class="c-rem">
    </colgroup>
    <thead>
      <tr>
        <th>Date</th><th>Shift</th><th>Day</th>
        <th>Time In</th><th>Time Out</th><th>Work Hours</th>
        <th>Late Arrival</th><th>Half Day</th><th>Status</th><th>Remarks</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  ${summaryHtml}

  <div class="legend">
    <div class="legend-item"><span class="legend-box" style="background:#fff3b0"></span>Late</div>
    <div class="legend-item"><span class="legend-box" style="background:#ffe0b2"></span>Half Day</div>
    <div class="legend-item"><span class="legend-box" style="background:#ffcccc"></span>Absent</div>
    <div class="legend-item"><span class="legend-box" style="background:#ffff99"></span>Incomplete (no check-out)</div>
    <div class="legend-item"><span class="legend-box" style="background:#e0e0e0"></span>Rest Day</div>
  </div>

</div>
${mode === "print" ? `<script>
  window.onload = function() {
    window.print();
    setTimeout(function() { window.close(); }, 1000);
  };
</script>` : ""}
</body>
</html>`;

  const win = window.open("", "_blank", "width=1200,height=900");
  if (!win) {
    alert("Please allow pop-ups to print/save as PDF.");
    return;
  }
  win.document.write(html);
  win.document.close();
}
