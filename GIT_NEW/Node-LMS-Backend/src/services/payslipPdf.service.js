import PDFDocument from 'pdfkit';
import path from 'path';

import { getCompanyLogoAbs } from './documents.service.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Payslip PDF — a pdfkit port of LMS-Web/src/app/(auth)/payroll/Payslip.tsx.
//
// Same sections, same grouping of the earning lines and the same subtotal rules
// as the web slip, so a payslip downloaded on a phone reads exactly like the one
// HR prints. If the web layout changes, change this with it.
// ---------------------------------------------------------------------------

const PAGE_MARGIN = 28;
const FONT = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';

const C = {
  text: '#111827',
  muted: '#6b7280',
  faint: '#9ca3af',
  border: '#d1d5db',
  rule: '#f3f4f6',
  headBg: '#f3f4f6',
  headText: '#4b5563',
  subBg: '#ecfeff',   // cyan-50  — subtotal rows
  egBg: '#eff6ff',    // blue-50  — earned gross / total earning
  red: '#b91c1c',
  blue: '#1d4ed8',
  green: '#047857',
  indigo: '#4f46e5',
  boxBorder: '#bfdbfe',
};

const money = (v) => (v == null ? '' : Math.round(v).toLocaleString('en-US'));

const sumBy = (lines, key, pred) => lines.filter(pred).reduce((a, l) => a + (l[key] || 0), 0);

/** Trim `text` with an ellipsis so it fits `width` at the current font. */
const fit = (doc, text, width) => {
  const s = String(text ?? '');
  if (doc.widthOfString(s) <= width) return s;
  let out = s;
  while (out.length > 1 && doc.widthOfString(`${out}…`) > width) out = out.slice(0, -1);
  return `${out}…`;
};

// pdfkit embeds PNG and JPEG only; any other logo format is skipped.
const EMBEDDABLE_LOGO = new Set(['.png', '.jpg', '.jpeg']);

const loadLogo = async (compc) => {
  if (!compc) return null;
  try {
    const p = await getCompanyLogoAbs(compc);
    return p && EMBEDDABLE_LOGO.has(path.extname(p).toLowerCase()) ? p : null;
  } catch (e) {
    logger.warn(`[PAYSLIP_PDF] logo lookup failed for compc=${compc}: ${e.message ?? e}`);
    return null;
  }
};

/**
 * A four-column table (Description | This Month | Jul to Jun | Jan to Dec).
 * `rows` items: { desc, this, fiscal, cal, bg?, bold? } or { empty: 'text' }.
 * Returns the y just below the table.
 */
const drawTable = (doc, x, y, width, title, rows) => {
  const numW = 52;
  const descW = width - numW * 3;
  const rowH = 12;
  const pad = 3;
  const cols = [
    { w: descW, align: 'left' },
    { w: numW, align: 'right' },
    { w: numW, align: 'right' },
    { w: numW, align: 'right' },
  ];

  const drawRow = (cells, top, { bg, bold, color = C.text, head = false } = {}) => {
    if (bg) doc.rect(x, top, width, rowH).fill(bg);
    doc.font(bold || head ? FONT_BOLD : FONT).fontSize(7.5).fillColor(color);
    let cx = x;
    cells.forEach((cell, i) => {
      const w = cols[i].w - pad * 2;
      doc.text(fit(doc, cell, w), cx + pad, top + 3, { width: w, align: cols[i].align, lineBreak: false });
      cx += cols[i].w;
    });
  };

  const top = y;
  drawRow([title, 'This Month', 'Jul to Jun', 'Jan to Dec'], y, { bg: C.headBg, head: true, color: C.headText });
  y += rowH;
  doc.moveTo(x, y).lineTo(x + width, y).lineWidth(0.5).strokeColor(C.border).stroke();

  for (const r of rows) {
    if (r.empty) {
      doc.font(FONT).fontSize(7.5).fillColor(C.faint)
        .text(r.empty, x, y + 3, { width, align: 'center', lineBreak: false });
    } else {
      drawRow([r.desc, money(r.this), money(r.fiscal), money(r.cal)], y, { bg: r.bg, bold: r.bold });
    }
    y += rowH;
    doc.moveTo(x, y).lineTo(x + width, y).lineWidth(0.5).strokeColor(C.rule).stroke();
  }

  doc.rect(x, top, width, y - top).lineWidth(0.75).strokeColor(C.border).stroke();
  return y;
};

const hdrField = (doc, x, y, width, labelText, value, accent = false) => {
  doc.font(FONT).fontSize(8).fillColor(C.muted);
  const lbl = `${labelText} : `;
  doc.text(lbl, x, y, { lineBreak: false });
  const lw = doc.widthOfString(lbl);
  doc.font(FONT_BOLD).fillColor(accent ? C.blue : C.text);
  doc.text(fit(doc, value ?? '', width - lw), x + lw, y, { lineBreak: false });
};

/** Render a payslip (the shape getPayslip returns) to a PDF buffer. */
export const buildPayslipPdf = async (data) => {
  const logo = await loadLogo(data.header?.company_compc);

  return new Promise((resolve, reject) => {
    try {
      const h = data.header;
      const E = data.earnings ?? [];
      const type1 = E.filter((e) => e.atype === 1);
      const adjustments = E.filter((e) => e.atype === 2 || e.atype === 3);
      const leave = E.filter((e) => e.atype === 4);

      // Subtotals come from the line items, exactly as the web slip computes them.
      const tri = (lines, pred) => ({
        this: sumBy(lines, 'this', pred), fiscal: sumBy(lines, 'fiscal', pred), cal: sumBy(lines, 'cal', pred),
      });
      const all = () => true;
      const actualGross = tri(E, (e) => e.atype === 1);
      const daysAdj = tri(adjustments, all);
      const leaveSum = tri(leave, all);
      const earnedGross = {
        this: actualGross.this + daysAdj.this + leaveSum.this,
        fiscal: actualGross.fiscal + daysAdj.fiscal + leaveSum.fiscal,
        cal: actualGross.cal + daysAdj.cal + leaveSum.cal,
      };
      const ded = data.totals;

      const doc = new PDFDocument({
        size: 'A4',
        layout: 'portrait',
        margins: { top: PAGE_MARGIN, bottom: PAGE_MARGIN, left: PAGE_MARGIN, right: PAGE_MARGIN },
        info: { Title: `Pay Slip ${h.code} ${h.period_label}` },
      });
      const buffers = [];
      doc.on('data', (b) => buffers.push(b));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', reject);

      const X = PAGE_MARGIN;
      const W = doc.page.width - PAGE_MARGIN * 2;
      let y = PAGE_MARGIN;

      // ── Title ──
      let tx = X;
      if (logo) {
        try {
          doc.image(logo, X, y, { fit: [110, 40], valign: 'center' });
          tx = X + 122;
        } catch (e) {
          logger.warn(`[PAYSLIP_PDF] logo not embeddable: ${e.message ?? e}`);
        }
      }
      doc.font(FONT_BOLD).fontSize(15).fillColor(C.red)
        .text(h.company_name || 'Company', tx, y + 4, { width: W - (tx - X), lineBreak: false });
      doc.font(FONT_BOLD).fontSize(10).fillColor(C.blue)
        .text(`Pay Slip For the Month of ${h.period_label}`, tx, y + 24, { lineBreak: false });
      y += 46;
      doc.moveTo(X, y).lineTo(X + W, y).lineWidth(1.5).strokeColor(C.border).stroke();
      y += 10;

      // ── Header grid (3 columns) ──
      const colW = (W - 24) / 3;
      const lineH = 12;
      const columns = [
        [
          ['Department', h.dept_name], ['Grade', h.grade],
          ['Working Days', String(h.w_day ?? '')], ['Total Absent', String(h.absent_days ?? '')],
          ['Total Earning Days', String(h.earning_days ?? '')],
        ],
        [
          ['Name', h.name], ['Code', h.code], ['Location', h.location, true], ['Designation', h.designation],
        ],
        [
          ['Bank Account # / Cash', h.bank_acct], ['Bank Branch', ''],
          ['Employee Type', h.emp_type], ['Joining Date', h.joining_date],
        ],
      ];
      columns.forEach((fields, ci) => {
        fields.forEach(([l, v, accent], ri) => hdrField(doc, X + ci * (colW + 12), y + ri * lineH, colW, l, v, accent));
      });
      y += Math.max(...columns.map((c) => c.length)) * lineH + 10;

      // ── Earnings | Deductions ──
      const gap = 12;
      const tableW = (W - gap) / 2;
      const line = (e) => ({ desc: e.desc, this: e.this, fiscal: e.fiscal, cal: e.cal });

      const earningRows = [
        ...type1.map(line),
        { desc: 'Actual Gross :-', ...actualGross, bg: C.subBg, bold: true },
        ...adjustments.map(line),
        ...(adjustments.length ? [{ desc: 'Days Adjustment :-', ...daysAdj, bg: C.subBg, bold: true }] : []),
        ...leave.map(line),
        ...(leave.length ? [{ desc: 'Leave Without Pay :-', ...leaveSum, bg: C.subBg, bold: true }] : []),
        { desc: 'Earned Gross :-', ...earnedGross, bg: C.egBg, bold: true },
        { desc: 'Total Earning', ...earnedGross, bg: C.egBg, bold: true },
      ];
      const leftBottom = drawTable(doc, X, y, tableW, 'Description', earningRows);

      const deductionRows = [
        ...(data.deductions.length ? data.deductions.map(line) : [{ empty: 'No deductions' }]),
        {
          desc: 'Total Deductions', this: ded.deduction_this, fiscal: ded.deduction_fiscal, cal: ded.deduction_cal,
          bg: C.subBg, bold: true,
        },
      ];
      const rx = X + tableW + gap;
      let ry = drawTable(doc, rx, y, tableW, 'Deductions', deductionRows);

      ry += 12;
      doc.font(FONT_BOLD).fontSize(9).fillColor(C.green).text('Outstanding Loan Balances..', rx, ry, { lineBreak: false });
      ry += 13;
      if (!data.loans.length) {
        doc.font(FONT).fontSize(8).fillColor(C.faint).text('None', rx, ry, { lineBreak: false });
        ry += 12;
      } else {
        const loanTop = ry;
        for (const l of data.loans) {
          doc.font(FONT).fontSize(7.5).fillColor(C.text)
            .text(fit(doc, l.loan_desc, tableW - 70), rx + 3, ry + 3, { lineBreak: false });
          doc.text(money(l.balance), rx + tableW - 63, ry + 3, { width: 60, align: 'right', lineBreak: false });
          ry += 12;
          doc.moveTo(rx, ry).lineTo(rx + tableW, ry).lineWidth(0.5).strokeColor(C.rule).stroke();
        }
        doc.rect(rx, loanTop, tableW, ry - loanTop).lineWidth(0.75).strokeColor('#e5e7eb').stroke();
      }

      y = Math.max(leftBottom, ry) + 16;

      // ── Summary box ──
      const boxW = 210;
      const boxH = 70;
      doc.roundedRect(X, y, boxW, boxH, 8).lineWidth(1.5).strokeColor(C.boxBorder).stroke();
      const sumRow = (lbl, val, top, color = C.text, size = 9) => {
        doc.font(FONT_BOLD).fontSize(size).fillColor(color).text(lbl, X + 10, top, { lineBreak: false });
        doc.text(val, X + 10, top, { width: boxW - 20, align: 'right', lineBreak: false });
      };
      sumRow('Total Earning', money(earnedGross.this), y + 8);
      sumRow('Total Deduction', money(ded.deduction_this), y + 21);
      sumRow('Less Amount', '0', y + 34);
      doc.moveTo(X + 10, y + 48).lineTo(X + boxW - 10, y + 48).lineWidth(0.75).strokeColor(C.boxBorder).stroke();
      sumRow('Net Payable', money(ded.net_payable), y + 53, C.red, 10);
      y += boxH + 24;

      // ── Footer ──
      doc.moveTo(X, y).lineTo(X + W, y).lineWidth(0.75).strokeColor(C.border).stroke();
      y += 6;
      doc.font(FONT).fontSize(7.5).fillColor(C.muted)
        .text('This is computer generated document no signature required.', X, y, { lineBreak: false });
      y += 12;
      const powered = 'Powered by ';
      doc.fillColor(C.faint).text(powered, X, y, { lineBreak: false });
      const px = X + doc.widthOfString(powered);
      // pdfkit sizes the link box from the text width; without an explicit one
      // (lineBreak: false) that width is NaN and the whole PDF fails to render.
      doc.font(FONT_BOLD).fillColor(C.indigo);
      const site = 'HRMS.sysnovix.com';
      doc.text(site, px, y, { width: doc.widthOfString(site) + 1, link: 'https://hrms.sysnovix.com', lineBreak: false });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
