// Reusable "download as PDF" for any tabular data. Opens a print window with a
// branded header (the company name — never a hardcoded brand) and auto-prints so
// the user can Save as PDF. The document title (and therefore the suggested PDF
// file name) is built from the company name + report title.

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export interface PdfColumn {
  header: string;
  align?: "left" | "center" | "right";
}

export function printTablePdf(opts: {
  companyName?: string;
  title: string;
  meta?: string; // e.g. a date range or filter description
  columns: (string | PdfColumn)[];
  rows: (string | number | null | undefined)[][];
  landscape?: boolean;
}) {
  const cols: PdfColumn[] = opts.columns.map((c) => (typeof c === "string" ? { header: c } : c));
  const company = (opts.companyName || "").trim();
  const runTime = new Date().toLocaleString("en-US", {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const docTitle = [company || "Report", opts.title].filter(Boolean).join(" - ");

  const thead = cols
    .map((c) => `<th style="text-align:${c.align || "left"}">${esc(c.header)}</th>`)
    .join("");
  const tbody = opts.rows.length
    ? opts.rows
        .map((r) => `<tr>${cols.map((c, i) => `<td style="text-align:${c.align || "left"}">${esc(r[i])}</td>`).join("")}</tr>`)
        .join("")
    : `<tr><td colspan="${cols.length}" style="text-align:center;color:#888;padding:14px">No data</td></tr>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(docTitle)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{font-family:Arial,sans-serif;font-size:10px;color:#000;background:#fff}
  @page{size:A4 ${opts.landscape ? "landscape" : "portrait"};margin:10mm 8mm}
  .header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #1a1a1a;padding-bottom:6px;margin-bottom:8px}
  .header-left{display:flex;align-items:center;gap:10px}
  .header-left img{height:34px;width:auto;object-fit:contain}
  .header-title{font-size:16px;font-weight:bold;letter-spacing:.3px}
  .header-subtitle{font-size:12px;font-weight:bold;margin-top:1px;color:#333}
  .header-meta{font-size:9px;color:#555;margin-top:2px}
  .header-right{font-size:9px;color:#555;text-align:right}
  table.data{width:100%;border-collapse:collapse;font-size:9px;margin-top:6px}
  table.data th{padding:4px 5px;border:1px solid #aaa;background:#4472C4;color:#fff;font-weight:600;white-space:nowrap}
  table.data td{padding:2.5px 5px;border:1px solid #ddd;vertical-align:middle}
  table.data tr:nth-child(even) td{background:#f5f7fb}
  tr{page-break-inside:avoid}
</style></head><body>
  <div class="header">
    <div class="header-left">
      <img src="/LMS_Black.png" alt="" onerror="this.style.display='none'">
      <div>
        <div class="header-title">${esc(company || "Report")}</div>
        <div class="header-subtitle">${esc(opts.title)}</div>
        ${opts.meta ? `<div class="header-meta">${esc(opts.meta)}</div>` : ""}
      </div>
    </div>
    <div class="header-right">Report run on:&nbsp;&nbsp;${runTime}<br>${opts.rows.length} record(s)</div>
  </div>
  <table class="data"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>
  <script>window.onload=function(){window.print();setTimeout(function(){window.close()},1000)}</script>
</body></html>`;

  const win = window.open("", "_blank", "width=1200,height=900");
  if (!win) {
    alert("Please allow pop-ups to download/print the PDF.");
    return;
  }
  win.document.write(html);
  win.document.close();
}
