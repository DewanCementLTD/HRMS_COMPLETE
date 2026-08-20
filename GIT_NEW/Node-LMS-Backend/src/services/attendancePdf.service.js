import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { getAttendanceReportRange, getAttendanceSummary, getPdfEmployeeDetails } from './attendance.service.js';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const fmtDateUpper = (d) => {
  if (!d) return '';
  const parts = d.split('-');
  if (parts.length !== 3) return d.toUpperCase();
  const y = parts[0];
  const mVal = parseInt(parts[1], 10);
  const dVal = parseInt(parts[2], 10);
  if (isNaN(mVal) || isNaN(dVal) || mVal < 1 || mVal > 12) return d.toUpperCase();
  const dayStr = String(dVal).padStart(2, '0');
  const monStr = MONTHS[mVal - 1];
  return `${dayStr}-${monStr}-${y.substring(2)}`;
};

const fmtGeneratedTime = () => {
  const now = new Date();
  const dVal = now.getDate();
  const mVal = now.getMonth();
  const y = now.getFullYear();
  let h = now.getHours();
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  h = h ? h : 12;
  
  const dayStr = String(dVal).padStart(2, '0');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monStr = months[mVal];
  return `Report run on: ${monStr} ${dayStr}, ${y} at ${h}:${mi} ${ampm}`;
};

const COMP_LOGO_ROOT = process.env.COMP_LOGO_ROOT || 'C:\\Erp_Systems\\HRMS_LMS_APP\\COMP_LOGO';
const LOGO_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'];

const getCompanyLogoAbs = (comp_img, comp_name) => {
  if (!comp_img && !comp_name) return null;
  const img = (comp_img || '').trim();
  if (img) {
    if (fs.existsSync(img)) return img;
    const cand = path.join(COMP_LOGO_ROOT, path.basename(img));
    if (fs.existsSync(cand)) return cand;
  }
  const descr = (comp_name || '').trim();
  const safe = descr.replace(/[^A-Za-z0-9]+/g, '');
  if (safe) {
    for (const ext of LOGO_EXTS) {
      const p = path.join(COMP_LOGO_ROOT, `${safe}_logo.${ext}`);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
};

export const buildAttendancePdf = (card_no, from_date, to_date) => {
  return new Promise(async (resolve, reject) => {
    try {
      const rows = await getAttendanceReportRange(card_no, from_date, to_date);
      const summary = await getAttendanceSummary(card_no, from_date, to_date);
      const empDetails = (await getPdfEmployeeDetails(card_no)) || {};
      
      const compName = empDetails.comp_name || 'Demo Company';

      const doc = new PDFDocument({
        size: 'A4',
        layout: 'landscape',
        margins: { top: 30, bottom: 30, left: 30, right: 30 },
        info: { Title: `Time Sheet ${card_no}` },
      });

      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      const startX = 30;
      const rightX = 841.89 - 30; // A4 Landscape width is 841.89
      const contentWidth = rightX - startX;

      let currentY = doc.y;

      const drawHeader = () => {
        const logoPath = getCompanyLogoAbs(empDetails.comp_img, empDetails.comp_name);
        
        let headerTextX = startX;
        
        if (logoPath) {
          try {
            doc.image(logoPath, startX, currentY, { width: 30, height: 30 });
            headerTextX = startX + 40;
          } catch (e) {
            // Draw circle fallback
            doc.circle(startX + 15, currentY + 15, 15).lineWidth(1).strokeColor('#0056b3').stroke();
            doc.font('Helvetica-Bold').fontSize(10).fillColor('#0056b3').text('LMS', startX + 3, currentY + 11);
            headerTextX = startX + 40;
          }
        } else {
          doc.circle(startX + 15, currentY + 15, 15).lineWidth(1).strokeColor('#0056b3').stroke();
          doc.font('Helvetica-Bold').fontSize(10).fillColor('#0056b3').text('LMS', startX + 3, currentY + 11);
          headerTextX = startX + 40;
        }

        doc.font('Helvetica-Bold').fontSize(14).fillColor('#000000').text(compName, headerTextX, currentY);
        doc.font('Helvetica-Bold').fontSize(11).text('Time Sheet', headerTextX, currentY + 16);

        // Right aligned report run on
        doc.font('Helvetica').fontSize(8).fillColor('#555555').text(fmtGeneratedTime(), startX, currentY + 20, {
          align: 'right',
          width: contentWidth
        });
        
        currentY += 40;

        // Draw Employee Details Box
        // 2 Rows, 4 Columns (approx percentages for widths)
        const rowH = 14;
        
        // Horizontal lines
        doc.moveTo(startX, currentY).lineTo(rightX, currentY).lineWidth(0.5).strokeColor('#000000').stroke();
        doc.moveTo(startX, currentY + rowH).lineTo(rightX, currentY + rowH).stroke();
        doc.moveTo(startX, currentY + rowH * 2).lineTo(rightX, currentY + rowH * 2).stroke();
        
        // Background for labels
        const col1W = 200;
        const col2W = 150;
        const col3W = 150;
        const col4W = rightX - (startX + col1W + col2W + col3W);
        
        const c1X = startX;
        const c2X = startX + col1W;
        const c3X = startX + col1W + col2W;
        const c4X = startX + col1W + col2W + col3W;

        // Vertical lines
        [c1X, c2X, c3X, c4X, rightX].forEach(x => {
          doc.moveTo(x, currentY).lineTo(x, currentY + rowH * 2).stroke();
        });

        const drawCell = (x, y, w, h, label, val) => {
          doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000').text(label + ' :', x + 3, y + 3, { continued: true });
          doc.font('Helvetica').text(' ' + (val || '—'));
        };

        // Row 1
        drawCell(c1X, currentY, col1W, rowH, 'Name', empDetails.emp_name);
        drawCell(c2X, currentY, col2W, rowH, 'Card No', card_no);
        drawCell(c3X, currentY, col3W, rowH, 'Emp #', empDetails.empcode);
        drawCell(c4X, currentY, col4W, rowH, 'Department', empDetails.department);
        
        // Row 2
        drawCell(c1X, currentY + rowH, col1W, rowH, 'From', `${fmtDateUpper(from_date)}  To : ${fmtDateUpper(to_date)}`);
        drawCell(c2X, currentY + rowH, col2W, rowH, 'Designation', empDetails.designation);
        drawCell(c3X, currentY + rowH, col3W, rowH, 'Status', empDetails.status);
        drawCell(c4X, currentY + rowH, col4W, rowH, 'Mobile', empDetails.mobile_no);
        
        currentY += rowH * 2 + 10;
        
        // Table Header
        const hRowH = 18;
        doc.rect(startX, currentY, contentWidth, hRowH).fill('#4A73B1'); // Blue background
        
        const headers = ['Date', 'Shift', 'Day', 'Time In', 'Time Out', 'Work Hours', 'Late Arrival', 'Half Day', 'Status', 'Remarks'];
        // Adjust column widths to fit 10 cols
        const tColW = [60, 40, 70, 50, 50, 70, 70, 70, 70, contentWidth - 550];
        
        let curX = startX;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#FFFFFF');
        headers.forEach((h, i) => {
          doc.text(h, curX, currentY + 5, { width: tColW[i], align: 'center' });
          curX += tColW[i];
        });
        
        currentY += hRowH;
        return tColW;
      };

      const tColW = drawHeader();

      // Table Rows
      rows.forEach((r) => {
        if (currentY + 16 > 595.27 - 80) { // Page height is 595.27 for landscape A4
          doc.addPage();
          currentY = 30;
          drawHeader();
        }

        const isLate = r.status === 'Late';
        const isHalfDay = r.status === 'Half Day';
        const isAbsent = r.status === 'Absent';
        const isOff = r.roster_shift === 'R';
        
        let bg = '#FFFFFF';
        if (isLate) bg = '#FFF9C4'; // light yellow
        if (isHalfDay) bg = '#FFE0B2'; // light orange
        if (isAbsent) bg = '#FFCDD2'; // light pink
        if (isOff) bg = '#F5F5F5'; // light gray
        
        // Ensure "Off" row styling logic handles status correctly
        const rowH = 16;
        doc.rect(startX, currentY, contentWidth, rowH).fill(bg);
        
        const worked = (r.w_hrs || r.w_mnt) ? `${String(r.w_hrs || 0).padStart(2,'0')}:${String(r.w_mnt || 0).padStart(2, '0')}` : '-';
        
        const remarks = (r.leave_remarks || r.roster_remarks || '').slice(0, 40);
        
        const rowData = [
          fmtDateUpper(r.roster_date),
          r.roster_shift || '',
          (r.day_name || '').toUpperCase(),
          r.in_time || '',
          r.out_time || '',
          worked,
          isLate ? 'Late' : '',
          isHalfDay ? 'Half Day' : '',
          r.status || (isOff ? 'Off' : ''),
          remarks
        ];

        let curX = startX;
        rowData.forEach((val, i) => {
          let tColor = '#000000';
          let f = 'Helvetica';
          if (i === 6 && val === 'Late') { tColor = '#E65100'; f = 'Helvetica-Bold'; } // Dark orange
          if (i === 7 && val === 'Half Day') { tColor = '#E65100'; f = 'Helvetica-Bold'; }
          if (i === 8 && val === 'Absent') { tColor = '#D32F2F'; f = 'Helvetica-Oblique'; } // Dark red italic
          if (i === 9 && isAbsent && !val) { val = 'Absent'; tColor = '#D32F2F'; f = 'Helvetica-Oblique'; }
          else if (i === 9 && val === 'Absent') { tColor = '#D32F2F'; f = 'Helvetica-Oblique'; }
          
          doc.font(f).fontSize(8).fillColor(tColor).text(val, curX, currentY + 4, { width: tColW[i], align: 'center' });
          curX += tColW[i];
        });
        
        currentY += rowH;
      });

      // Summary Table
      currentY += 10;
      if (currentY + 50 > 595.27 - 30) {
        doc.addPage();
        currentY = 30;
      }

      doc.font('Helvetica-Bold').fontSize(9).fillColor('#000000');
      const sumLabels = ['Total Days', 'Present', 'Absent', 'Incomplete', 'Late', 'Half Day'];
      const sumVals = [
        summary.total_days || 0,
        summary.present || 0,
        summary.absent_days || 0,
        summary.incomplete || 0,
        summary.late_days || 0,
        summary.half_days || 0
      ];
      
      const sumW = 60;
      let sX = startX;
      
      // Top row (headers)
      doc.rect(sX, currentY, sumW * 6, 16).fill('#E0E0E0');
      doc.rect(sX, currentY, sumW * 6, 16).lineWidth(0.5).strokeColor('#BDBDBD').stroke();
      
      sumLabels.forEach((lbl, i) => {
        doc.fillColor('#000000').text(lbl, sX + (sumW * i), currentY + 4, { width: sumW, align: 'center' });
        if (i > 0) doc.moveTo(sX + (sumW * i), currentY).lineTo(sX + (sumW * i), currentY + 32).stroke();
      });
      
      currentY += 16;
      
      // Bottom row (values)
      doc.rect(sX, currentY, sumW * 6, 16).lineWidth(0.5).strokeColor('#BDBDBD').stroke();
      sumVals.forEach((val, i) => {
        let vColor = '#000000';
        if (i === 1) vColor = '#2E7D32'; // Green for present
        if (i === 2) vColor = '#D32F2F'; // Red for absent
        if (i === 3) vColor = '#F57C00'; // Orange for incomplete
        if (i === 4) vColor = '#E65100'; // Orange for late
        if (i === 5) vColor = '#D32F2F'; // Red for half day
        doc.fillColor(vColor).text(String(val), sX + (sumW * i), currentY + 4, { width: sumW, align: 'center' });
      });
      
      currentY += 30;
      
      // Legend
      const drawLegend = (x, color, label) => {
        doc.rect(x, currentY, 10, 10).fill(color);
        doc.rect(x, currentY, 10, 10).lineWidth(0.5).strokeColor('#000000').stroke();
        doc.fillColor('#000000').font('Helvetica').fontSize(8).text(label, x + 15, currentY + 2);
        return x + 20 + doc.widthOfString(label) + 15;
      };
      
      let lX = startX;
      lX = drawLegend(lX, '#FFF9C4', 'Late');
      lX = drawLegend(lX, '#FFE0B2', 'Half Day');
      lX = drawLegend(lX, '#FFCDD2', 'Absent');
      lX = drawLegend(lX, '#FFFFFF', 'Incomplete (no check-out)');
      lX = drawLegend(lX, '#F5F5F5', 'Rest Day');

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
