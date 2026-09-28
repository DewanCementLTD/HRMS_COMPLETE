import { listMyFinalPayslips, getMyFinalPayslip } from '../services/payroll.service.js';
import { buildPayslipPdf } from '../services/payslipPdf.service.js';

// Employee self-service payslips. Only finalised (posted) months are ever
// returned; see the service for why. Every route sits behind requireEmployee,
// so the card here is always the caller's own.

const NOT_FOUND = { detail: 'No finalised payslip for this period' };

// GET /auth/payslips/:card_no
export const myPayslips = async (req, res, next) => {
  try {
    const { card_no } = res.locals.validated.params;
    const items = await listMyFinalPayslips(card_no);
    if (items === null) return res.status(404).json({ detail: 'Employee not found' });
    res.json({ items });
  } catch (err) {
    next(err);
  }
};

// GET /auth/payslips/:card_no/:period
export const myPayslip = async (req, res, next) => {
  try {
    const { card_no, period } = res.locals.validated.params;
    const slip = await getMyFinalPayslip(card_no, period);
    if (!slip) return res.status(404).json(NOT_FOUND);
    res.json(slip);
  } catch (err) {
    next(err);
  }
};

// GET /auth/payslips/:card_no/:period/pdf
export const myPayslipPdf = async (req, res, next) => {
  try {
    const { card_no, period } = res.locals.validated.params;
    const slip = await getMyFinalPayslip(card_no, period);
    if (!slip) return res.status(404).json(NOT_FOUND);

    const pdf = await buildPayslipPdf(slip);
    const month = String(slip.header.period_label || `period-${period}`).replace(/[^A-Za-z0-9]+/g, '-');
    const code = String(slip.header.code || card_no).replace(/[^A-Za-z0-9.]+/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payslip_${code}_${month}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(pdf);
  } catch (err) {
    next(err);
  }
};
