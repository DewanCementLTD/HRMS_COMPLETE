/**
 * Provident Fund calculation engine — pure functions, no DB access.
 *
 * Reproduces the "product" method of the legacy Excel PF statements
 * (F-78 / F-84 / K-51), with no rounding, CEILING or FLOOR anywhere:
 *
 *   product  = amount × days it stays in the fund until the cut-off date
 *   profit   = Σ product × profit_rate / 365        (divisor is always 365)
 *
 * Financial year runs 1 Jul → 30 Jun. The cut-off is 30 Jun, or the exit date
 * in the year an employee leaves. A monthly contribution is credited on the
 * last day of its period, so July earns 334 days, June 0 — exactly the Excel
 * DAYS column. Real calendar days are used (Excel hard-coded Feb = 28, which
 * over-counted one day for Feb–Jun of leap years).
 *
 * Company contribution = employee contribution (100% carbon copy).
 *
 * Permanent (non-refundable) withdrawal — balance-reduction method: the amount
 * leaves the balance on the withdrawal date (split between the employee and
 * company parts in proportion to their balances), so profit stops on it from
 * that day. This is what the Excel "profit thereof" deduction approximated.
 *
 * PF loan (refundable withdrawal) — markup = profit rate + spread (1%), the
 * Income Tax Rules 2002 (rule 4(3) of the PF withdrawal rules) treatment and
 * the pattern in every Excel file (5.87% → 6.87%, 9% → 10%, 16% → 17%).
 * Interest = loan product × loan rate / 365, charged to the employee part at
 * the year's cut-off. A disbursement counts its own day (Excel: Aug-22 → Jun-30
 * = 313 days); a withdrawal does not (Jul-18 → Jun-30 = 348 days).
 */

export const PF_DEFAULTS = Object.freeze({
  contribRate: 0.0833,
  basicDivisor: 1.55,
  loanSpread: 0.01,
  zakatRate: 0.025,
  profitDivisor: 365,
});

const DAY_MS = 86400000;

const toUtc = (s) => {
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fmt = (ms) => new Date(ms).toISOString().slice(0, 10);

export const daysBetween = (fromStr, toStr) => Math.round((toUtc(toStr) - toUtc(fromStr)) / DAY_MS);
export const addDays = (s, n) => fmt(toUtc(s) + n * DAY_MS);
const minDate = (a, b) => (a <= b ? a : b);

export const fiscalYearOf = (dateStr) => {
  const y = Number(String(dateStr).slice(0, 4));
  const m = Number(String(dateStr).slice(5, 7));
  const fy = m >= 7 ? y : y - 1;
  return { from: `${fy}-07-01`, to: `${fy + 1}-06-30` };
};

export const fyLabel = (fyFrom) => {
  const y = Number(String(fyFrom).slice(0, 4));
  return `${y}-${String(y + 1).slice(2)}`;
};

// Basic = (earned_gross - FPO) / 1.55 ; PF = basic × 8.33%. No rounding.
export const pfBasic = (earnedGross, fpo, cfg = PF_DEFAULTS) =>
  (Number(earnedGross || 0) - Number(fpo || 0)) / cfg.basicDivisor;

export const pfContribution = (earnedGross, fpo, cfg = PF_DEFAULTS) =>
  Math.max(0, pfBasic(earnedGross, fpo, cfg) * cfg.contribRate);

const daysLeft = (valueDate, cutoff) => Math.max(0, daysBetween(valueDate, cutoff));

/**
 * One financial year for one member.
 *
 * contributions : [{ period, period_frm, value_date, amount?, earned_gross?, fpo?, basic? }]
 *                 amount is the PF actually deducted by payroll; when absent it
 *                 falls back to pfContribution(earned_gross, fpo)
 * withdrawals   : [{ doc, date, amount }]           permanent withdrawals
 * loanMovements : [{ date, amount, kind, ref }]     all-time; +disbursement, -recovery
 */
export const computeYear = ({
  fyFrom, fyTo, cutoff = fyTo,
  opening = { emp: 0, co: 0 },
  contributions = [], withdrawals = [], loanMovements = [],
  profitRate, loanRate, cfg = PF_DEFAULTS,
}) => {
  const end = minDate(cutoff, fyTo);
  const openDate = addDays(fyFrom, -1);
  const openDays = daysBetween(openDate, end);

  const lines = [{
    line_type: "OPEN", value_date: openDate,
    emp_amt: opening.emp, co_amt: opening.co, days: openDays,
    emp_product: opening.emp * openDays, co_product: opening.co * openDays,
  }];

  const contribLines = contributions
    .filter((c) => c.value_date >= fyFrom && c.value_date <= fyTo && (c.period_frm || c.value_date) <= end)
    .map((c) => {
      const amount = c.amount ?? pfContribution(c.earned_gross, c.fpo, cfg);
      const days = daysLeft(c.value_date, end);
      return {
        line_type: "CONTRIB", value_date: c.value_date, period: c.period ?? null,
        earned_gross: c.earned_gross ?? null, fpo: c.fpo ?? null,
        basic: c.basic ?? (c.earned_gross !== undefined && c.earned_gross !== null ? pfBasic(c.earned_gross, c.fpo, cfg) : null),
        payroll_deducted: c.payroll_deducted ?? null,
        emp_amt: amount, co_amt: amount, days,
        emp_product: amount * days, co_product: amount * days,
      };
    });

  // Withdrawals are split on the balances standing on the withdrawal date:
  // opening + contributions credited on or before that date - earlier withdrawals.
  const wds = withdrawals
    .filter((w) => w.date >= fyFrom && w.date <= end)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const wdLines = [];
  for (const w of wds) {
    let balE = opening.emp;
    let balC = opening.co;
    for (const c of contribLines) if (c.value_date <= w.date) { balE += c.emp_amt; balC += c.co_amt; }
    for (const p of wdLines) { balE += p.emp_amt; balC += p.co_amt; }
    const total = balE + balC;
    const amount = Number(w.amount);
    if (amount > total + 1e-6) {
      const err = new Error(`Withdrawal of ${amount} on ${w.date} exceeds the PF balance of ${total} on that date`);
      err.code = "PF_WITHDRAWAL_EXCEEDS_BALANCE";
      throw err;
    }
    const shareE = total > 0 ? balE / total : 0.5;
    const e = amount * shareE;
    const c = amount - e;
    const days = daysLeft(w.date, end);
    wdLines.push({
      line_type: "WITHDRAW", value_date: w.date, ref_doc: w.doc ?? null,
      emp_amt: -e, co_amt: -c, days, emp_product: -e * days, co_product: -c * days,
    });
  }

  lines.push(...contribLines, ...wdLines);
  lines.sort((a, b) => (a.value_date < b.value_date ? -1 : a.value_date > b.value_date ? 1 : 0));

  const sum = (arr, k) => arr.reduce((s, l) => s + l[k], 0);
  const empProduct = sum(lines, "emp_product");
  const coProduct = sum(lines, "co_product");
  const empProfit = Math.max(0, empProduct) * profitRate / cfg.profitDivisor;
  const coProfit = Math.max(0, coProduct) * profitRate / cfg.profitDivisor;
  const contribTotal = sum(contribLines, "emp_amt");
  const wdE = -sum(wdLines, "emp_amt");
  const wdC = -sum(wdLines, "co_amt");

  // PF loan
  const loanOpening = loanMovements.filter((m) => m.date < fyFrom).reduce((s, m) => s + Number(m.amount), 0);
  const loanLines = [{
    line_type: "LOAN_OPEN", value_date: openDate, amount: loanOpening, days: openDays, product: loanOpening * openDays,
  }];
  for (const m of loanMovements.filter((x) => x.date >= fyFrom && x.date <= end)) {
    // A disbursement bears markup from the day it is paid out (inclusive), as in
    // every Excel loan sheet; recoveries are credited at the period end.
    const days = daysLeft(m.date, end) + (Number(m.amount) >= 0 ? 1 : 0);
    loanLines.push({
      line_type: Number(m.amount) >= 0 ? "LOAN_DISB" : "LOAN_REC", value_date: m.date,
      ref_doc: m.ref ?? null, kind: m.kind ?? null,
      amount: Number(m.amount), days, product: Number(m.amount) * days,
    });
  }
  loanLines.sort((a, b) => (a.value_date < b.value_date ? -1 : a.value_date > b.value_date ? 1 : 0));
  const loanProduct = loanLines.reduce((s, l) => s + l.product, 0);
  const loanInterest = Math.max(0, loanProduct) * loanRate / cfg.profitDivisor;
  const loanClosing = loanLines.reduce((s, l) => s + l.amount, 0);

  return {
    fy_from: fyFrom, fy_to: fyTo, fy_label: fyLabel(fyFrom), cutoff: end,
    profit_rate: profitRate, loan_rate: loanRate,
    lines,
    emp: {
      opening: opening.emp, contribution: contribTotal, product: empProduct, profit: empProfit,
      withdrawn: wdE, loan_interest: loanInterest,
      closing: opening.emp + contribTotal + empProfit - wdE - loanInterest,
    },
    co: {
      opening: opening.co, contribution: contribTotal, product: coProduct, profit: coProfit,
      withdrawn: wdC, closing: opening.co + contribTotal + coProfit - wdC,
    },
    loan: { opening: loanOpening, product: loanProduct, interest: loanInterest, closing: loanClosing, lines: loanLines },
  };
};

/**
 * Rate for a year: the declared one, else the latest earlier declared rate
 * (provisional — what the Excel did for the leaving year before the trustees
 * announced the new rate).
 */
export const resolveRate = (rates, fyFrom) => {
  const exact = rates.find((r) => r.fy_from === fyFrom);
  if (exact) return { rate: Number(exact.profit_rate), provisional: false };
  const earlier = rates.filter((r) => r.fy_from < fyFrom).sort((a, b) => (a.fy_from < b.fy_from ? 1 : -1))[0];
  if (earlier) return { rate: Number(earlier.profit_rate), provisional: true };
  return null;
};

/**
 * Every financial year of one member up to `upto` (or the exit date, if earlier).
 * Posted years are taken as frozen; the rest are computed and chained.
 *
 * takeOn  : { as_of_fy, emp_balance, co_balance } | null
 * posted  : { [fy_from]: year in computeYear() shape }
 * rates   : [{ fy_from, profit_rate }]
 */
export const buildHistory = ({
  upto, exitDate = null, takeOn = null, posted = {}, rates = [],
  contributions = [], withdrawals = [], loanMovements = [], cfg = PF_DEFAULTS,
}) => {
  const end = exitDate ? minDate(exitDate, upto) : upto;

  let startFy;
  if (takeOn) {
    startFy = takeOn.as_of_fy;
  } else {
    const dates = [
      ...Object.keys(posted),
      ...contributions.map((c) => c.value_date),
      ...withdrawals.map((w) => w.date),
      ...loanMovements.map((m) => m.date),
    ].filter(Boolean).sort();
    if (!dates.length) return { years: [], end, loan_outstanding: 0, emp_balance: 0, co_balance: 0 };
    startFy = fiscalYearOf(dates[0]).from;
  }

  const years = [];
  let opening = takeOn ? { emp: takeOn.emp_balance, co: takeOn.co_balance } : { emp: 0, co: 0 };
  for (let fy = fiscalYearOf(startFy); fy.from <= end; fy = fiscalYearOf(`${Number(fy.from.slice(0, 4)) + 1}-07-01`)) {
    if (posted[fy.from]) {
      const y = { ...posted[fy.from], status: "posted", provisional: false };
      years.push(y);
      opening = { emp: y.emp.closing, co: y.co.closing };
      continue;
    }
    const r = resolveRate(rates, fy.from);
    if (!r) {
      const err = new Error(`No PF profit rate declared for ${fyLabel(fy.from)} or any earlier year`);
      err.code = "PF_RATE_MISSING";
      throw err;
    }
    const y = computeYear({
      fyFrom: fy.from, fyTo: fy.to, cutoff: minDate(fy.to, end), opening,
      contributions, withdrawals, loanMovements,
      profitRate: r.rate, loanRate: r.rate + cfg.loanSpread, cfg,
    });
    y.status = "computed";
    y.provisional = r.provisional;
    years.push(y);
    opening = { emp: y.emp.closing, co: y.co.closing };
  }

  const loanOutstanding = loanMovements.filter((m) => m.date <= end).reduce((s, m) => s + Number(m.amount), 0);
  return { years, end, loan_outstanding: loanOutstanding, emp_balance: opening.emp, co_balance: opening.co };
};

/**
 * Final settlement from a member history (cut at the exit / settlement date).
 * Permanent withdrawals and loan interest are already inside the balances, so
 * they are reported for information only, never subtracted twice.
 */
export const computeSettlement = ({ history, zakatExempt = false, cfg = PF_DEFAULTS }) => {
  const total = (part, key) => history.years.reduce((s, y) => s + Number(y[part][key] || 0), 0);
  const empTotal = history.emp_balance;
  const coTotal = history.co_balance;
  const zakat = zakatExempt ? 0 : empTotal * cfg.zakatRate;
  const loanOutstanding = Math.max(0, history.loan_outstanding);
  return {
    settlement_date: history.end,
    years: history.years.map((y) => ({
      fy_label: y.fy_label, fy_from: y.fy_from, cutoff: y.cutoff, status: y.status, provisional: y.provisional,
      profit_rate: y.profit_rate,
      emp: { contribution: y.emp.contribution, profit: y.emp.profit, withdrawn: y.emp.withdrawn, loan_interest: y.emp.loan_interest },
      co: { contribution: y.co.contribution, profit: y.co.profit, withdrawn: y.co.withdrawn },
    })),
    totals: {
      emp: { contribution: total("emp", "contribution"), profit: total("emp", "profit"), withdrawn: total("emp", "withdrawn"), loan_interest: total("emp", "loan_interest") },
      co: { contribution: total("co", "contribution"), profit: total("co", "profit"), withdrawn: total("co", "withdrawn") },
    },
    employee_part: empTotal,
    zakat,
    zakat_exempt: zakatExempt,
    company_part: coTotal,
    gross_dues: empTotal - zakat + coTotal,
    less_loan_outstanding: loanOutstanding,
    amount_payable: empTotal - zakat + coTotal - loanOutstanding,
  };
};
