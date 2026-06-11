"""Salary / payslip repository — READ-ONLY.

Salary is processed by the ERP and stored in:
  - HR_SALARY_PROCESS_MASTER : one row per employee per period (gross/basic/days/net).
  - HR_SALARY_PROCESS        : line items (TRANS_TYPE 'A'=earning / 'D'=deduction,
                               TRANS_ID -> HR_ALLOWANCE.ALLOWANCE_ID / HR_DEDUCTION.DED_CD).
This module only reads & renders the payslip; it never recomputes payroll.
"""

from core.database import get_connection

_MONTHS = ["", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]


def _int(v, default=None):
    try:
        return int(float(str(v).strip()))
    except (ValueError, TypeError):
        return default


def _label(frm):
    if not frm or len(frm) < 7:
        return ""
    return f"{_MONTHS[int(frm[5:7])]} - {frm[0:4]}"


def _fiscal_cal_starts(period_frm):
    """Fiscal year runs Jul→Jun. Returns (fiscal_start, cal_start) as YYYY-MM-DD."""
    if not period_frm or len(period_frm) < 7:
        return None, None
    y, m = int(period_frm[0:4]), int(period_frm[5:7])
    fy = y if m >= 7 else y - 1
    return f"{fy}-07-01", f"{y}-01-01"


def list_salary_periods(compc=None) -> list:
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT m."PERIOD#", TO_CHAR(MIN(p.PERIOD_FRM),'YYYY-MM-DD'),
                   TO_CHAR(MIN(p.PERIOD_TO),'YYYY-MM-DD'), COUNT(*)
            FROM HR_SALARY_PROCESS_MASTER m
            LEFT JOIN HR_ATTND_PERIOD p ON p."PERIOD#" = m."PERIOD#" AND p.UNIT_ID = m.UNIT_ID
            WHERE (:u IS NULL OR m.UNIT_ID = :u)
            GROUP BY m."PERIOD#" ORDER BY m."PERIOD#" DESC
        """, {"u": _int(compc)})
        return [{"period": int(r[0]), "period_frm": r[1], "period_to": r[2],
                 "label": _label(r[1]) or f"Period {int(r[0])}", "emp_count": int(r[3])}
                for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


def list_processed_salaries(compc, period, q=None) -> list:
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT m.OLD_EMPCODE,
                   (SELECT MAX(e.NAME) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE=m.OLD_EMPCODE OR e.EMPCODE=m.OLD_EMPCODE),
                   (SELECT MAX(e."ATDTCARD#") FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE=m.OLD_EMPCODE OR e.EMPCODE=m.OLD_EMPCODE),
                   (SELECT MAX(e.EMPCODE) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE=m.OLD_EMPCODE OR e.EMPCODE=m.OLD_EMPCODE),
                   NVL((SELECT MIN(d.DEPT_NAME) FROM HR_DEPT d WHERE TO_CHAR(d.DEPT_NO)=TO_CHAR(m.DEPT_NO)), TO_CHAR(m.DEPT_NO)),
                   NVL(m.ACTUAL_GROSS,0), NVL(m.EARNED_GROSS,0), NVL(m.TOTAL_EARNING,0),
                   (SELECT NVL(SUM(s.TRANS_AMOUNT),0) FROM HR_SALARY_PROCESS s
                      WHERE s.OLD_EMPCODE=m.OLD_EMPCODE AND s."PERIOD#"=m."PERIOD#" AND s.UNIT_ID=m.UNIT_ID AND s.TRANS_TYPE='D'),
                   m.SAL
            FROM HR_SALARY_PROCESS_MASTER m
            WHERE m."PERIOD#" = :p AND (:u IS NULL OR m.UNIT_ID = :u)
            ORDER BY 2
        """, {"p": _int(period), "u": _int(compc)})
        out = []
        for r in cur.fetchall():
            earned = float(r[6] or 0); ded = float(r[8] or 0)
            net = float(r[9]) if r[9] is not None else (earned - ded)
            out.append({
                "old_empcode": (r[0] or "").strip(), "name": (r[1] or "").strip(),
                "atdtcard": (r[2] or "").strip(), "empcode": (r[3] or "").strip(),
                "dept_name": (r[4] or "").strip(), "actual_gross": float(r[5] or 0),
                "earned_gross": earned, "total_earning": float(r[7] or 0),
                "total_deduction": ded, "net": net,
            })
        if q:
            ql = q.lower()
            out = [o for o in out if ql in o["name"].lower() or ql in o["old_empcode"].lower() or ql in o["atdtcard"].lower()]
        return out
    finally:
        cur.close(); conn.close()


def get_payslip(compc, empcode, period) -> dict | None:
    conn = get_connection(); cur = conn.cursor()
    try:
        u = _int(compc); per = _int(period)
        # Resolve salary key (OLD_EMPCODE).
        key = str(empcode)
        try:
            cur.execute("SELECT OLD_EMPCODE FROM HR_EMP_MASTER WHERE EMPCODE = :e", {"e": str(empcode)})
            r = cur.fetchone()
            if r and r[0]:
                key = str(r[0]).strip()
        except Exception:
            pass

        cur.execute("""
            SELECT NVL(ACTUAL_GROSS,0), NVL(ACTUAL_BASIC,0), NVL(EARNED_GROSS,0), NVL(EARNED_BASIC,0),
                   NVL(W_DAY,0), NVL(ABSENT_DAYS,0), NVL(TOTAL_EARNING,0), SAL, GRADE_CD, DEPT_NO,
                   LOCATION, BNKACCT, EMP_STATUS, OLD_EMPCODE
            FROM HR_SALARY_PROCESS_MASTER
            WHERE OLD_EMPCODE IN (:e, :ec) AND "PERIOD#" = :p AND (:u IS NULL OR UNIT_ID = :u)
            FETCH FIRST 1 ROWS ONLY
        """, {"e": key, "ec": str(empcode), "p": per, "u": u})
        m = cur.fetchone()
        if not m:
            return None
        key = (m[13] or key)

        cur.execute("""SELECT TO_CHAR(PERIOD_FRM,'YYYY-MM-DD'), TO_CHAR(PERIOD_TO,'YYYY-MM-DD')
                       FROM HR_ATTND_PERIOD WHERE "PERIOD#" = :p AND (:u IS NULL OR UNIT_ID = :u) FETCH FIRST 1 ROWS ONLY""",
                    {"p": per, "u": u})
        pr = cur.fetchone()
        pfrm = pr[0] if pr else None
        pend = (pr[1] if pr else None) or "2099-12-31"
        fstart, cstart = _fiscal_cal_starts(pfrm) if pfrm else (None, None)
        minstart = min(x for x in [fstart, cstart] if x) if (fstart or cstart) else None

        cur.execute("""
            SELECT NAME, "ATDTCARD#", TO_CHAR(DTOFAPPT,'YYYY-MM-DD'), GRADE_CD,
                   (SELECT MIN(dg.DESG_DESC) FROM HR_DESG dg WHERE dg.DESG_CD = HR_EMP_MASTER.DESG_CD),
                   (SELECT MIN(d.DEPT_NAME) FROM HR_DEPT d WHERE TO_CHAR(d.DEPT_NO)=TO_CHAR(HR_EMP_MASTER.DEPT_NO)),
                   (SELECT MIN(l.DESCR) FROM COM_LOCATION l WHERE TRIM(l.LCODE)=TRIM(HR_EMP_MASTER.LOCATION)),
                   (SELECT MIN(s.EMP_STATUS_DESC) FROM HR_EMP_STATUS s WHERE s.EMP_STATUS = HR_EMP_MASTER.EMP_STATUS),
                   BNKACCT, (SELECT MIN(u2.UNIT_NAME) FROM UNIT_MST u2 WHERE u2.UNIT_ID = HR_EMP_MASTER.UNIT_ID)
            FROM HR_EMP_MASTER WHERE OLD_EMPCODE = :e OR EMPCODE = :ec FETCH FIRST 1 ROWS ONLY
        """, {"e": key, "ec": str(empcode)})
        h = cur.fetchone() or [None] * 10

        cur.execute("""
            SELECT l.TRANS_TYPE,
                   SUM(CASE WHEN l."PERIOD#" = :p THEN l.TRANS_AMOUNT ELSE 0 END),
                   SUM(CASE WHEN :fstart IS NOT NULL AND pp.PERIOD_FRM BETWEEN TO_DATE(:fstart,'YYYY-MM-DD') AND TO_DATE(:pend,'YYYY-MM-DD') THEN l.TRANS_AMOUNT ELSE 0 END),
                   SUM(CASE WHEN :cstart IS NOT NULL AND pp.PERIOD_FRM BETWEEN TO_DATE(:cstart,'YYYY-MM-DD') AND TO_DATE(:pend,'YYYY-MM-DD') THEN l.TRANS_AMOUNT ELSE 0 END),
                   MAX(CASE WHEN l.TRANS_TYPE='A' THEN a.ALLOWANCE_DESC ELSE d.DED_DESC END),
                   MAX(NVL(CASE WHEN l.TRANS_TYPE='A' THEN a.PAY_SEQ ELSE d.PAY_SEQ END, 999)),
                   MAX(NVL(a.ALLOWANCE_TYPE, 2)), l.TRANS_ID
            FROM HR_SALARY_PROCESS l
            LEFT JOIN HR_ATTND_PERIOD pp ON pp."PERIOD#" = l."PERIOD#" AND pp.UNIT_ID = l.UNIT_ID
            LEFT JOIN HR_ALLOWANCE a ON l.TRANS_TYPE='A' AND TRIM(TO_CHAR(a.ALLOWANCE_ID)) = TRIM(l.TRANS_ID)
            LEFT JOIN HR_DEDUCTION d ON l.TRANS_TYPE='D' AND TRIM(TO_CHAR(d.DED_CD)) = TRIM(l.TRANS_ID)
            WHERE l.OLD_EMPCODE = :e AND (:u IS NULL OR l.UNIT_ID = :u)
              AND (l."PERIOD#" = :p OR (:minstart IS NOT NULL AND pp.PERIOD_FRM BETWEEN TO_DATE(:minstart,'YYYY-MM-DD') AND TO_DATE(:pend,'YYYY-MM-DD')))
            GROUP BY l.TRANS_TYPE, l.TRANS_ID
            ORDER BY l.TRANS_TYPE, MAX(NVL(CASE WHEN l.TRANS_TYPE='A' THEN a.PAY_SEQ ELSE d.PAY_SEQ END, 999))
        """, {"p": per, "e": key, "u": u, "fstart": fstart, "cstart": cstart, "pend": pend, "minstart": minstart})

        earnings, deductions = [], []
        for r in cur.fetchall():
            it = {"desc": (r[4] or r[7] or "").strip(), "this": float(r[1] or 0),
                  "fiscal": float(r[2] or 0), "cal": float(r[3] or 0), "atype": int(r[6] or 2)}
            (earnings if r[0] == "A" else deductions).append(it)

        master = {
            "actual_gross": float(m[0]), "actual_basic": float(m[1]),
            "earned_gross": float(m[2]), "earned_basic": float(m[3]),
            "w_day": float(m[4]), "absent_days": float(m[5]),
            "total_earning": float(m[6]), "net_pay": float(m[7]) if m[7] is not None else None,
        }
        ded_this = sum(d["this"] for d in deductions)
        ded_fiscal = sum(d["fiscal"] for d in deductions)
        ded_cal = sum(d["cal"] for d in deductions)
        net = master["net_pay"] if master["net_pay"] is not None else (master["total_earning"] - ded_this)

        cur.execute("""
            SELECT NVL(t.LOAN_DESC,'Loan'), NVL(l.LOAN_AMT,0) - NVL(l.LOAN_RECOVER,0)
            FROM HR_LOAN_MST l LEFT JOIN HR_LOAN_TYPE t ON t.LOAN_CD = l.LOAN_CD
            WHERE (l.OLD_EMPCODE = :e OR l.OLD_EMPCODE = :ec) AND (:u IS NULL OR l.UNIT_ID = :u)
              AND NVL(l.LOAN_AMT,0) - NVL(l.LOAN_RECOVER,0) > 0
        """, {"e": key, "ec": str(empcode), "u": u})
        loans = [{"loan_desc": (r[0] or "Loan").strip(), "balance": float(r[1] or 0)} for r in cur.fetchall()]

        return {
            "header": {
                "name": (h[0] or "").strip(), "code": (h[1] or "").strip(),
                "joining_date": h[2], "grade": (h[3] or m[8] or "").strip(),
                "designation": (h[4] or "").strip(), "dept_name": (h[5] or "").strip(),
                "location": (h[6] or "").strip(), "emp_type": (h[7] or "").strip(),
                "bank_acct": (h[8] or m[11] or "").strip(), "company_name": (h[9] or "").strip(),
                "period_label": _label(pfrm) if pfrm else f"Period {per}",
                "w_day": master["w_day"], "absent_days": master["absent_days"],
                "earning_days": master["w_day"] - master["absent_days"],
            },
            "earnings": earnings, "deductions": deductions, "master": master,
            "totals": {
                "earning_this": master["total_earning"], "deduction_this": ded_this,
                "deduction_fiscal": ded_fiscal, "deduction_cal": ded_cal, "net_payable": net,
            },
            "loans": loans,
        }
    finally:
        cur.close(); conn.close()
