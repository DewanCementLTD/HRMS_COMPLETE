import PDFDocument from "pdfkit";
import path from "path";

import { getDirectConnection } from "../config/database.js";
import { getCompanyLogoAbs } from "./documents.service.js";
import { logger } from "../utils/logger.js";
import { OUT_ARRAY, s, num, numOrNull, ymd, TrainingError } from "./trainingShared.service.js";

// ---------------------------------------------------------------------------
// Training certificate — A4 landscape, company logo + name, certificate number.
// Issued only once completeSession() has stamped CERT_NO on the participant.
// ---------------------------------------------------------------------------

const FONT = "Helvetica";
const FONT_BOLD = "Helvetica-Bold";
const FONT_ITALIC = "Helvetica-Oblique";
const C = { ink: "#0f172a", muted: "#64748b", brand: "#1d4ed8", gold: "#b45309", line: "#cbd5e1" };

const EMBEDDABLE_LOGO = new Set([".png", ".jpg", ".jpeg"]);

const loadLogo = async (compc) => {
  try {
    const p = await getCompanyLogoAbs(compc);
    return p && EMBEDDABLE_LOGO.has(path.extname(p).toLowerCase()) ? p : null;
  } catch (e) {
    logger.warn(`[TRAINING_CERT] logo lookup failed for compc=${compc}: ${e.message ?? e}`);
    return null;
  }
};

const longDate = (iso) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};

/**
 * Certificate data for one participant. `empcode` restricts it to the
 * employee's own certificate; `compc` restricts it to HR's company. One of
 * them is always given.
 */
export const loadCertificate = async (participantId, { empcode, compc }) => {
  const connection = await getDirectConnection();
  try {
    const binds = { pid: participantId };
    let where = "p.PARTICIPANT_ID = :pid";
    if (empcode) { where += " AND p.EMPCODE = :e"; binds.e = s(empcode); }
    if (compc) { where += " AND p.COMPC = :compc"; binds.compc = compc; }
    const r = await connection.execute(
      `SELECT p.CERT_NO, p.CERT_ISSUED_AT, p.EMPCODE, m.NAME, p.ATTEND_PCT, p.POST_SCORE_PCT,
              t.TITLE, t.COURSE_CODE, x.START_DATE, x.END_DATE, x.TOTAL_HOURS, tr.NAME, tr.ORGANIZATION,
              p.COMPC, (SELECT MAX(ci.DESCR) FROM COMPANY_INFO ci WHERE TO_CHAR(ci.COMPC) = TO_CHAR(p.COMPC)),
              (SELECT MAX(d.DEPT_NAME) FROM HR_DEPT d WHERE TO_CHAR(d.DEPT_NO) = m.DEPT_NO AND d.COMPC = m.UNIT_ID)
         FROM HR_TRAINING_PARTICIPANT p
         JOIN HR_TRAINING_SESSION x ON x.SESSION_ID = p.SESSION_ID
         JOIN HR_TRAINING_COURSE t ON t.COURSE_ID = x.COURSE_ID
         LEFT JOIN HR_TRAINER tr ON tr.TRAINER_ID = x.TRAINER_ID
         LEFT JOIN HR_EMP_MASTER m ON m.EMPCODE = p.EMPCODE
        WHERE ${where}`,
      binds, { outFormat: OUT_ARRAY },
    );
    const x = r.rows?.[0];
    if (!x) throw new TrainingError("Training not found", 404);
    if (!x[0]) throw new TrainingError("No certificate has been issued for this training", 404);
    return {
      cert_no: s(x[0]), issued_at: ymd(x[1]), empcode: s(x[2]), name: s(x[3]),
      attend_pct: numOrNull(x[4]), post_score_pct: numOrNull(x[5]),
      course_title: s(x[6]), course_code: s(x[7]), start_date: ymd(x[8]), end_date: ymd(x[9]),
      total_hours: numOrNull(x[10]), trainer_name: s(x[11]), trainer_org: s(x[12]),
      compc: num(x[13]), company_name: s(x[14]).trim(), dept_name: s(x[15]),
    };
  } finally {
    await connection.close();
  }
};

/**
 * The trainer's certificate of appreciation for one completed session.
 * `empcode` restricts it to the trainer themself; `compc` to HR's company.
 */
export const loadTrainerCertificate = async (sessionId, { empcode, compc }) => {
  const connection = await getDirectConnection();
  try {
    const binds = { id: sessionId };
    let where = "x.SESSION_ID = :id";
    if (empcode) { where += " AND tr.EMPCODE = :e AND tr.TRAINER_TYPE = 'I'"; binds.e = s(empcode); }
    if (compc) { where += " AND x.COMPC = :compc"; binds.compc = compc; }
    const r = await connection.execute(
      `SELECT x.TRAINER_CERT_NO, x.TRAINER_CERT_AT, tr.EMPCODE, tr.NAME, tr.ORGANIZATION,
              t.TITLE, t.COURSE_CODE, x.START_DATE, x.END_DATE, x.TOTAL_HOURS, x.COMPC,
              (SELECT MAX(ci.DESCR) FROM COMPANY_INFO ci WHERE TO_CHAR(ci.COMPC) = TO_CHAR(x.COMPC)),
              (SELECT COUNT(*) FROM HR_TRAINING_PARTICIPANT p WHERE p.SESSION_ID = x.SESSION_ID AND p.STATUS IN ('COMPLETED','FAILED')),
              (SELECT MAX(d.DEPT_NAME) FROM HR_EMP_MASTER m JOIN HR_DEPT d ON TO_CHAR(d.DEPT_NO) = m.DEPT_NO AND d.COMPC = m.UNIT_ID
                WHERE m.EMPCODE = tr.EMPCODE)
         FROM HR_TRAINING_SESSION x
         JOIN HR_TRAINER tr ON tr.TRAINER_ID = x.TRAINER_ID
         JOIN HR_TRAINING_COURSE t ON t.COURSE_ID = x.COURSE_ID
        WHERE ${where}`,
      binds, { outFormat: OUT_ARRAY },
    );
    const x = r.rows?.[0];
    if (!x) throw new TrainingError("Session not found", 404);
    if (!x[0]) throw new TrainingError("The certificate is issued once HR completes the session", 404);
    return {
      kind: "TRAINER", cert_no: s(x[0]), issued_at: ymd(x[1]), empcode: s(x[2]), name: s(x[3]), trainer_org: s(x[4]),
      course_title: s(x[5]), course_code: s(x[6]), start_date: ymd(x[7]), end_date: ymd(x[8]), total_hours: numOrNull(x[9]),
      compc: num(x[10]), company_name: s(x[11]).trim(), participants: num(x[12]), dept_name: s(x[13]),
      post_score_pct: null, trainer_name: "",
    };
  } finally {
    await connection.close();
  }
};

export const buildCertificatePdf = async (cert) => {
  const trainer = cert.kind === "TRAINER";
  const logo = await loadLogo(cert.compc);
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0, info: { Title: `Certificate ${cert.cert_no}` } });
      const chunks = [];
      doc.on("data", (b) => chunks.push(b));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const W = doc.page.width;
      const H = doc.page.height;

      // Double border.
      doc.lineWidth(3).strokeColor(C.brand).rect(24, 24, W - 48, H - 48).stroke();
      doc.lineWidth(0.8).strokeColor(C.gold).rect(34, 34, W - 68, H - 68).stroke();

      let y = 62;
      if (logo) {
        try {
          doc.image(logo, W / 2 - 60, y, { fit: [120, 50], align: "center", valign: "center" });
          y += 58;
        } catch (e) {
          logger.warn(`[TRAINING_CERT] logo not embeddable: ${e.message ?? e}`);
        }
      }
      doc.font(FONT_BOLD).fontSize(14).fillColor(C.ink).text(cert.company_name || "", 0, y, { width: W, align: "center" });
      y += 34;

      doc.font(FONT_BOLD).fontSize(34).fillColor(C.brand).text("CERTIFICATE", 0, y, { width: W, align: "center", characterSpacing: 4 });
      y += 42;
      doc.font(FONT).fontSize(13).fillColor(C.gold)
        .text(trainer ? "OF APPRECIATION" : "OF TRAINING COMPLETION", 0, y, { width: W, align: "center", characterSpacing: 2 });
      y += 40;

      doc.font(FONT_ITALIC).fontSize(12).fillColor(C.muted)
        .text(trainer ? "This certificate is proudly presented to" : "This is to certify that", 0, y, { width: W, align: "center" });
      y += 24;
      doc.font(FONT_BOLD).fontSize(26).fillColor(C.ink).text(cert.name || cert.empcode, 0, y, { width: W, align: "center" });
      y += 34;
      doc.moveTo(W / 2 - 170, y).lineTo(W / 2 + 170, y).lineWidth(0.8).strokeColor(C.line).stroke();
      y += 8;
      doc.font(FONT).fontSize(10).fillColor(C.muted)
        .text([cert.empcode, cert.dept_name || (trainer ? cert.trainer_org : "")].filter(Boolean).join("  ·  "), 0, y, { width: W, align: "center" });
      y += 26;

      doc.font(FONT_ITALIC).fontSize(12).fillColor(C.muted)
        .text(trainer ? "with sincere thanks for conducting the training" : "has successfully completed the training", 0, y, { width: W, align: "center" });
      y += 22;
      doc.font(FONT_BOLD).fontSize(18).fillColor(C.brand).text(cert.course_title, 80, y, { width: W - 160, align: "center" });
      y = doc.y + 8;

      const period = cert.start_date === cert.end_date
        ? `held on ${longDate(cert.start_date)}`
        : `held from ${longDate(cert.start_date)} to ${longDate(cert.end_date)}`;
      const extras = [cert.total_hours ? `${cert.total_hours} hours` : null,
        trainer && cert.participants ? `${cert.participants} participant${cert.participants === 1 ? "" : "s"}` : null,
        cert.post_score_pct !== null && cert.post_score_pct !== undefined ? `assessment score ${cert.post_score_pct}%` : null].filter(Boolean).join(", ");
      doc.font(FONT).fontSize(11).fillColor(C.ink).text(`${period}${extras ? ` (${extras})` : ""}.`, 80, y, { width: W - 160, align: "center" });

      // Footer: trainer signature line (left), HR signature line (right), cert no + date (centre).
      const fy = H - 118;
      const sig = (x, label, sub) => {
        doc.moveTo(x, fy).lineTo(x + 190, fy).lineWidth(0.8).strokeColor(C.ink).stroke();
        doc.font(FONT_BOLD).fontSize(10).fillColor(C.ink).text(label, x, fy + 6, { width: 190, align: "center" });
        if (sub) doc.font(FONT).fontSize(8.5).fillColor(C.muted).text(sub, x, fy + 20, { width: 190, align: "center" });
      };
      if (trainer) sig(80, "Head of Department", "Learning & Development");
      else sig(80, cert.trainer_name || "Trainer", cert.trainer_name ? ["Trainer", cert.trainer_org].filter(Boolean).join(" · ") : "");
      sig(W - 270, "Head of HR", "Human Resources");

      doc.font(FONT).fontSize(9).fillColor(C.muted)
        .text(`Certificate No: ${cert.cert_no}`, 0, fy - 4, { width: W, align: "center" })
        .text(`Issued: ${longDate(cert.issued_at)}`, 0, fy + 10, { width: W, align: "center" });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
};
