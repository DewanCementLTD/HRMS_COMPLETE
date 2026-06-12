"""Payroll entry repository — period-based data the ERP salary process consumes.

Four modules, all per-company (UNIT_ID) and (except loan recovery) keyed to a
payroll PERIOD — normally the company's currently *open* period:

  1. Loan recovery / adjustment  -> HR_LOAN_RECOVERY (ledger; reads loan in HR_LOAN_MST)
  2. Monthly allowances          -> HR_MONTHLY_ALLOW  (LOV: HR_ALLOWANCE, INCL_GROSS='N')
  3. Monthly deductions          -> HR_MONTHLY_DED    (LOV: HR_DEDUCTION)
  4. Absent days                 -> HR_ABSENT_DAYS

Employee records elsewhere are keyed by OLD_EMPCODE (e.g. '100001.1'); the UI
sends EMPCODE, which we resolve with HR_EMP_MASTER. Branch = HR_EMP_MASTER.LOCATION.
"""

from core.database import get_connection

_MONTHS = ["", "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

# Recovery type LOV. There is no lookup table in the DB for this 1-char column
# (HR_LOAN_RECOVERY.RECOVERY_TYPE), so these are the business options exposed in
# the dropdown. Change the labels/codes here to adjust the list everywhere.
RECOVERY_TYPES = [
    {"value": "C", "label": "Cash Recovery"},
    {"value": "S", "label": "Salary Deduction"},
    {"value": "A", "label": "Adjustment / Write-off"},
]
_RECOVERY_LABELS = {r["value"]: r["label"] for r in RECOVERY_TYPES}


def _int(v, default=None):
    try:
        return int(float(str(v).strip()))
    except (ValueError, TypeError):
        return default


def _num(v):
    if v is None or str(v).strip() == "":
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None


def _s(v):
    if v is None or str(v).strip() == "":
        return None
    return str(v).strip()


def _label(frm):
    if not frm or len(frm) < 7:
        return ""
    return f"{_MONTHS[int(frm[5:7])]} - {frm[0:4]}"


# Reusable employee-info subselects (name / designation / department), matching
# the fixes used elsewhere (leading-zero codes; department scoped per company).
_EMP_COLS = """
    (SELECT MAX(e.NAME) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE = {alias}.OLD_EMPCODE OR e.EMPCODE = {alias}.OLD_EMPCODE),
    (SELECT MAX(e.EMPCODE) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE = {alias}.OLD_EMPCODE OR e.EMPCODE = {alias}.OLD_EMPCODE),
    (SELECT MIN(dg.DESG_DESC) FROM HR_EMP_MASTER e JOIN HR_DESG dg ON LTRIM(dg.DESG_CD,'0')=LTRIM(e.DESG_CD,'0')
       WHERE e.OLD_EMPCODE = {alias}.OLD_EMPCODE OR e.EMPCODE = {alias}.OLD_EMPCODE),
    (SELECT MIN(d.DEPT_NAME) FROM HR_EMP_MASTER e JOIN HR_DEPT d
            ON LTRIM(d.DEPT_NO,'0')=LTRIM(e.DEPT_NO,'0') AND TO_CHAR(d.COMPC)=TO_CHAR(e.UNIT_ID)
       WHERE e.OLD_EMPCODE = {alias}.OLD_EMPCODE OR e.EMPCODE = {alias}.OLD_EMPCODE)
"""


def _emp_link(cur, empcode: str) -> str:
    """Value stored in *.OLD_EMPCODE for an employee — prefer their OLD_EMPCODE,
    else the empcode itself."""
    try:
        cur.execute("SELECT OLD_EMPCODE FROM HR_EMP_MASTER WHERE EMPCODE = :e OR OLD_EMPCODE = :e", {"e": str(empcode)})
        r = cur.fetchone()
        if r and r[0]:
            return str(r[0]).strip()
    except Exception:
        pass
    return str(empcode)


# ════════════════════════════════════════════════════════════════
# PERIODS — the company's open period(s)
# ════════════════════════════════════════════════════════════════

def list_open_periods(compc) -> list:
    """Open (STATUS='O') periods for a company, newest first."""
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT "PERIOD#", RULE_ID, TO_CHAR(PERIOD_FRM,'YYYY-MM-DD'),
                   TO_CHAR(PERIOD_TO,'YYYY-MM-DD'), P_DAYS
            FROM HR_ATTND_PERIOD
            WHERE UNIT_ID = :u AND UPPER(NVL(STATUS,'O')) = 'O'
            ORDER BY PERIOD_FRM DESC, "PERIOD#" DESC
        """, {"u": _int(compc)})
        return [{
            "period": int(r[0]), "rule_id": int(r[1]) if r[1] is not None else None,
            "period_frm": r[2], "period_to": r[3], "p_days": r[4],
            "label": _label(r[2]) or f"Period {int(r[0])}",
        } for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


def _resolve_period(cur, compc, period=None):
    """Return (period#, rule_id) for an open period of the company. If `period`
    is given it must be open; otherwise the latest open period is used. Returns
    (None, None) when there is no matching open period."""
    u = _int(compc)
    if period is not None:
        cur.execute("""SELECT "PERIOD#", RULE_ID FROM HR_ATTND_PERIOD
                       WHERE UNIT_ID = :u AND "PERIOD#" = :p AND UPPER(NVL(STATUS,'O')) = 'O'""",
                    {"u": u, "p": _int(period)})
    else:
        cur.execute("""SELECT "PERIOD#", RULE_ID FROM HR_ATTND_PERIOD
                       WHERE UNIT_ID = :u AND UPPER(NVL(STATUS,'O')) = 'O'
                       ORDER BY PERIOD_FRM DESC, "PERIOD#" DESC FETCH FIRST 1 ROWS ONLY""",
                    {"u": u})
    r = cur.fetchone()
    if not r:
        return None, None
    return int(r[0]), (int(r[1]) if r[1] is not None else None)


# ════════════════════════════════════════════════════════════════
# 1 — LOAN RECOVERY / ADJUSTMENT  (HR_LOAN_RECOVERY)
# ════════════════════════════════════════════════════════════════

def recovery_types() -> list:
    return list(RECOVERY_TYPES)


def _loan_outstanding(cur, doc) -> tuple:
    """Return (old_empcode, loan_amt, outstanding) for a loan, where outstanding
    = loan_amt - LOAN_RECOVER - sum(manual recoveries already recorded)."""
    cur.execute("SELECT OLD_EMPCODE, NVL(LOAN_AMT,0), NVL(LOAN_RECOVER,0) FROM HR_LOAN_MST WHERE \"DOC#\" = :d",
                {"d": _int(doc)})
    r = cur.fetchone()
    if not r:
        return None, 0.0, 0.0
    old_emp = (r[0] or "").strip(); amt = float(r[1] or 0); rec = float(r[2] or 0)
    cur.execute("SELECT NVL(SUM(RECOVERD_AMT),0) FROM HR_LOAN_RECOVERY WHERE \"DOC#\" = :d", {"d": _int(doc)})
    manual = float(cur.fetchone()[0] or 0)
    return old_emp, amt, amt - rec - manual


def list_recoverable_loans(compc, brnch=None) -> list:
    """Loans of the company with employee info and current outstanding balance."""
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute(f"""
            SELECT l."DOC#", l.OLD_EMPCODE, t.LOAN_DESC, l.LOAN_CD,
                   NVL(l.LOAN_AMT,0), NVL(l.LOAN_RECOVER,0),
                   NVL((SELECT SUM(rc.RECOVERD_AMT) FROM HR_LOAN_RECOVERY rc WHERE rc."DOC#" = l."DOC#"),0),
                   {_EMP_COLS.format(alias="l")},
                   (SELECT MAX(e.LOCATION) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE = l.OLD_EMPCODE OR e.EMPCODE = l.OLD_EMPCODE)
            FROM HR_LOAN_MST l
            LEFT JOIN HR_LOAN_TYPE t ON t.LOAN_CD = l.LOAN_CD
            WHERE l.UNIT_ID = :u
            ORDER BY l."DOC#" DESC
        """, {"u": _int(compc)})
        b = _s(brnch)
        out = []
        for r in cur.fetchall():
            loc = (r[11] or "").strip() if r[11] else ""
            if b and loc != b:
                continue
            amt = float(r[4] or 0); outstanding = amt - float(r[5] or 0) - float(r[6] or 0)
            out.append({
                "doc": int(r[0]), "old_empcode": (r[1] or "").strip(),
                "loan_desc": (r[2] or "").strip() or (r[3] or "").strip(),
                "loan_amt": amt, "balance": outstanding,
                "name": (r[7] or "").strip(), "empcode": (r[8] or r[1] or "").strip(),
                "designation": (r[9] or "").strip(), "department": (r[10] or "").strip(),
            })
        return out
    finally:
        cur.close(); conn.close()


def list_loan_recoveries(compc, doc=None, brnch=None) -> list:
    conn = get_connection(); cur = conn.cursor()
    try:
        conds = ["rc.UNIT_ID = :u"]; params = {"u": _int(compc)}
        if doc is not None:
            conds.append('rc."DOC#" = :d'); params["d"] = _int(doc)
        where = " AND ".join(conds)
        cur.execute(f"""
            SELECT rc.ROWID, rc."DOC#", rc."PERIOD#", NVL(rc.RECOVERD_AMT,0), rc.RECOVERY_TYPE,
                   NVL(rc.BALANCE_AMT,0), rc.REMARKS, rc.OLD_EMPCODE,
                   {_EMP_COLS.format(alias="rc")},
                   (SELECT MAX(e.LOCATION) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE = rc.OLD_EMPCODE OR e.EMPCODE = rc.OLD_EMPCODE),
                   NVL(l.LOAN_AMT,0),
                   (SELECT t.LOAN_DESC FROM HR_LOAN_TYPE t WHERE t.LOAN_CD = l.LOAN_CD)
            FROM HR_LOAN_RECOVERY rc
            LEFT JOIN HR_LOAN_MST l ON l."DOC#" = rc."DOC#"
            WHERE {where}
            ORDER BY rc."DOC#" DESC, rc.USR_DATE_UPD DESC
        """, params)
        b = _s(brnch)
        out = []
        for r in cur.fetchall():
            loc = (r[12] or "").strip() if r[12] else ""
            if b and loc != b:
                continue
            rt = (r[4] or "").strip()
            out.append({
                "rowid": str(r[0]), "doc": int(r[1]) if r[1] is not None else None,
                "period": int(r[2]) if r[2] is not None else None,
                "recovered_amt": float(r[3] or 0), "recovery_type": rt,
                "recovery_type_label": _RECOVERY_LABELS.get(rt, rt),
                "balance_amt": float(r[5] or 0), "remarks": (r[6] or "").strip(),
                "old_empcode": (r[7] or "").strip(), "name": (r[8] or "").strip(),
                "empcode": (r[9] or r[7] or "").strip(), "designation": (r[10] or "").strip(),
                "department": (r[11] or "").strip(), "loan_amt": float(r[13] or 0),
                "loan_desc": (r[14] or "").strip(),
            })
        return out
    finally:
        cur.close(); conn.close()


def create_loan_recovery(compc, doc, recovery_type, recovered_amt, remarks, int_rate_rec=None,
                         period=None, usr=None) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        u = _int(compc)
        d = _int(doc)
        if d is None:
            return {"status": "error", "message": "Select a loan"}
        amt = _num(recovered_amt)
        if amt is None or amt <= 0:
            return {"status": "error", "message": "Recovery amount must be greater than zero"}
        per, _rule = _resolve_period(cur, u, period)
        if per is None:
            return {"status": "error", "message": "No open period for this company. Open a period first."}
        old_emp, loan_amt, outstanding = _loan_outstanding(cur, d)
        if old_emp is None:
            return {"status": "error", "message": "Loan not found"}
        if amt > outstanding + 0.01:
            return {"status": "error",
                    "message": f"Recovery ({amt:,.0f}) exceeds the outstanding balance ({outstanding:,.0f})"}
        balance = outstanding - amt
        cur.execute("""
            INSERT INTO HR_LOAN_RECOVERY
              ("DOC#", "PERIOD#", RECOVERD_AMT, RECOVERY_TYPE, INT_RATE_REC, UNIT_ID,
               BALANCE_AMT, USR_ID_UPD, USR_DATE_UPD, REMARKS, OLD_EMPCODE)
            VALUES (:d, :p, :amt, :rt, :ir, :u, :bal, :usr, SYSDATE, :rem, :emp)
        """, {"d": d, "p": per, "amt": amt, "rt": (_s(recovery_type) or "C")[:1],
              "ir": _num(int_rate_rec), "u": u, "bal": balance, "usr": (_s(usr) or "HR")[:2],
              "rem": (_s(remarks) or "")[:50], "emp": old_emp})
        conn.commit()
        return {"status": "success", "balance": balance}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


def delete_loan_recovery(compc, rowid) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM HR_LOAN_RECOVERY WHERE ROWID = :rid AND UNIT_ID = :u",
                    {"rid": str(rowid), "u": _int(compc)})
        conn.commit()
        if cur.rowcount == 0:
            return {"status": "error", "message": "Recovery not found"}
        return {"status": "success"}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


# ════════════════════════════════════════════════════════════════
# 2 — MONTHLY ALLOWANCES  (HR_MONTHLY_ALLOW; LOV HR_ALLOWANCE INCL_GROSS='N')
# ════════════════════════════════════════════════════════════════

def list_allowance_types() -> list:
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT ALLOWANCE_ID, ALLOWANCE_DESC, ALLOWANCE_TYPE
            FROM HR_ALLOWANCE WHERE INCL_GROSS = 'N'
            ORDER BY LPAD(ALLOWANCE_ID, 5)
        """)
        return [{"allowance_id": (r[0] or "").strip(), "allowance_desc": (r[1] or "").strip(),
                 "allowance_type": r[2]} for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


def list_monthly_allowances(compc, period=None, empcode=None, brnch=None) -> list:
    conn = get_connection(); cur = conn.cursor()
    try:
        u = _int(compc)
        per, _rule = _resolve_period(cur, u, period)
        if per is None:
            return []
        conds = ['a.UNIT_ID = :u', 'a."PERIOD#" = :p']
        params = {"u": u, "p": per}
        if empcode:
            link = _emp_link(cur, str(empcode))
            conds.append("(a.OLD_EMPCODE = :e OR a.OLD_EMPCODE = :ec)")
            params["e"] = link; params["ec"] = str(empcode)
        where = " AND ".join(conds)
        cur.execute(f"""
            SELECT a.OLD_EMPCODE, a.ALLOWANCE_ID, NVL(a.AMOUNT,0), a.OT_HOUR, a.REMARKS,
                   al.ALLOWANCE_DESC,
                   {_EMP_COLS.format(alias="a")},
                   (SELECT MAX(e.LOCATION) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE = a.OLD_EMPCODE OR e.EMPCODE = a.OLD_EMPCODE)
            FROM HR_MONTHLY_ALLOW a
            LEFT JOIN HR_ALLOWANCE al ON TRIM(al.ALLOWANCE_ID) = TRIM(a.ALLOWANCE_ID)
            WHERE {where}
            ORDER BY 7
        """, params)
        b = _s(brnch)
        out = []
        for r in cur.fetchall():
            loc = (r[10] or "").strip() if r[10] else ""
            if b and loc != b:
                continue
            out.append({
                "old_empcode": (r[0] or "").strip(), "allowance_id": (r[1] or "").strip(),
                "amount": float(r[2] or 0), "ot_hour": r[3], "remarks": (r[4] or "").strip(),
                "allowance_desc": (r[5] or "").strip(), "name": (r[6] or "").strip(),
                "empcode": (r[7] or r[0] or "").strip(), "designation": (r[8] or "").strip(),
                "department": (r[9] or "").strip(),
            })
        return out
    finally:
        cur.close(); conn.close()


def upsert_monthly_allowance(compc, empcode, allowance_id, amount, ot_hour=None,
                             remarks=None, period=None, usr=None) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        u = _int(compc)
        if not _s(empcode):
            return {"status": "error", "message": "Employee is required"}
        if not _s(allowance_id):
            return {"status": "error", "message": "Allowance is required"}
        per, rule = _resolve_period(cur, u, period)
        if per is None:
            return {"status": "error", "message": "No open period for this company. Open a period first."}
        if rule is None:
            rule = 0
        link = _emp_link(cur, str(empcode))
        cur.execute("""
            MERGE INTO HR_MONTHLY_ALLOW t
            USING (SELECT :e AS OLD_EMPCODE, :aid AS ALLOWANCE_ID, :p AS PNO,
                          :u AS UNIT_ID, :rid AS RULE_ID FROM dual) s
            ON (t.OLD_EMPCODE = s.OLD_EMPCODE AND t.ALLOWANCE_ID = s.ALLOWANCE_ID
                AND t."PERIOD#" = s.PNO AND t.UNIT_ID = s.UNIT_ID AND t.RULE_ID = s.RULE_ID)
            WHEN MATCHED THEN UPDATE SET t.AMOUNT = :amt, t.OT_HOUR = :ot, t.REMARKS = :rem,
                                         t.USR_ID_UPD = :usr, t.USR_DATE_UPD = SYSDATE
            WHEN NOT MATCHED THEN INSERT
              (OLD_EMPCODE, ALLOWANCE_ID, AMOUNT, "PERIOD#", UNIT_ID, USR_ID_UPD,
               USR_DATE_UPD, OT_HOUR, REMARKS, RULE_ID)
              VALUES (:e, :aid, :amt, :p, :u, :usr, SYSDATE, :ot, :rem, :rid)
        """, {"e": link, "aid": str(allowance_id).strip(), "p": per, "u": u, "rid": rule,
              "amt": _num(amount) or 0, "ot": _num(ot_hour), "rem": (_s(remarks) or "")[:50],
              "usr": (_s(usr) or "HR")[:2]})
        conn.commit()
        return {"status": "success", "period": per}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


def delete_monthly_allowance(compc, empcode, allowance_id, period=None) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        u = _int(compc)
        per, _rule = _resolve_period(cur, u, period)
        if per is None:
            return {"status": "error", "message": "No open period for this company."}
        link = _emp_link(cur, str(empcode))
        cur.execute("""DELETE FROM HR_MONTHLY_ALLOW
                       WHERE (OLD_EMPCODE = :e OR OLD_EMPCODE = :ec) AND ALLOWANCE_ID = :aid
                         AND "PERIOD#" = :p AND UNIT_ID = :u""",
                    {"e": link, "ec": str(empcode), "aid": str(allowance_id).strip(), "p": per, "u": u})
        conn.commit()
        if cur.rowcount == 0:
            return {"status": "error", "message": "Entry not found"}
        return {"status": "success"}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


# ════════════════════════════════════════════════════════════════
# 3 — MONTHLY DEDUCTIONS  (HR_MONTHLY_DED; LOV HR_DEDUCTION)
# ════════════════════════════════════════════════════════════════

def list_deduction_types(compc=None) -> list:
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT DED_CD, DED_DESC FROM HR_DEDUCTION
            WHERE (:u IS NULL OR UNIT_ID = :u OR UNIT_ID IS NULL)
            ORDER BY LPAD(DED_CD, 5)
        """, {"u": _int(compc)})
        return [{"deduction_id": (r[0] or "").strip(), "deduction_desc": (r[1] or "").strip()}
                for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


def list_monthly_deductions(compc, period=None, empcode=None, brnch=None) -> list:
    conn = get_connection(); cur = conn.cursor()
    try:
        u = _int(compc)
        per, _rule = _resolve_period(cur, u, period)
        if per is None:
            return []
        conds = ['a.UNIT_ID = :u', 'a."PERIOD#" = :p']
        params = {"u": u, "p": per}
        if empcode:
            link = _emp_link(cur, str(empcode))
            conds.append("(a.OLD_EMPCODE = :e OR a.OLD_EMPCODE = :ec)")
            params["e"] = link; params["ec"] = str(empcode)
        where = " AND ".join(conds)
        cur.execute(f"""
            SELECT a.OLD_EMPCODE, a.DEDUCTION_ID, NVL(a.AMOUNT,0), a.REMARKS,
                   dd.DED_DESC,
                   {_EMP_COLS.format(alias="a")},
                   (SELECT MAX(e.LOCATION) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE = a.OLD_EMPCODE OR e.EMPCODE = a.OLD_EMPCODE)
            FROM HR_MONTHLY_DED a
            LEFT JOIN HR_DEDUCTION dd ON TRIM(dd.DED_CD) = TRIM(a.DEDUCTION_ID)
            WHERE {where}
            ORDER BY 6
        """, params)
        b = _s(brnch)
        out = []
        for r in cur.fetchall():
            loc = (r[9] or "").strip() if r[9] else ""
            if b and loc != b:
                continue
            out.append({
                "old_empcode": (r[0] or "").strip(), "deduction_id": (r[1] or "").strip(),
                "amount": float(r[2] or 0), "remarks": (r[3] or "").strip(),
                "deduction_desc": (r[4] or "").strip(), "name": (r[5] or "").strip(),
                "empcode": (r[6] or r[0] or "").strip(), "designation": (r[7] or "").strip(),
                "department": (r[8] or "").strip(),
            })
        return out
    finally:
        cur.close(); conn.close()


def upsert_monthly_deduction(compc, empcode, deduction_id, amount, remarks=None,
                             period=None, usr=None) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        u = _int(compc)
        if not _s(empcode):
            return {"status": "error", "message": "Employee is required"}
        if not _s(deduction_id):
            return {"status": "error", "message": "Deduction is required"}
        per, _rule = _resolve_period(cur, u, period)
        if per is None:
            return {"status": "error", "message": "No open period for this company. Open a period first."}
        link = _emp_link(cur, str(empcode))
        cur.execute("""
            MERGE INTO HR_MONTHLY_DED t
            USING (SELECT :e AS OLD_EMPCODE, :did AS DEDUCTION_ID, :p AS PNO, :u AS UNIT_ID FROM dual) s
            ON (t.OLD_EMPCODE = s.OLD_EMPCODE AND t.DEDUCTION_ID = s.DEDUCTION_ID
                AND t."PERIOD#" = s.PNO AND t.UNIT_ID = s.UNIT_ID)
            WHEN MATCHED THEN UPDATE SET t.AMOUNT = :amt, t.REMARKS = :rem,
                                         t.USR_ID_UPD = :usr, t.USR_DATE_UPD = SYSDATE
            WHEN NOT MATCHED THEN INSERT
              (OLD_EMPCODE, DEDUCTION_ID, AMOUNT, "PERIOD#", UNIT_ID, USR_ID_UPD, USR_DATE_UPD, REMARKS)
              VALUES (:e, :did, :amt, :p, :u, :usr, SYSDATE, :rem)
        """, {"e": link, "did": str(deduction_id).strip(), "p": per, "u": u,
              "amt": _num(amount) or 0, "rem": (_s(remarks) or "")[:50], "usr": (_s(usr) or "HR")[:2]})
        conn.commit()
        return {"status": "success", "period": per}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


def delete_monthly_deduction(compc, empcode, deduction_id, period=None) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        u = _int(compc)
        per, _rule = _resolve_period(cur, u, period)
        if per is None:
            return {"status": "error", "message": "No open period for this company."}
        link = _emp_link(cur, str(empcode))
        cur.execute("""DELETE FROM HR_MONTHLY_DED
                       WHERE (OLD_EMPCODE = :e OR OLD_EMPCODE = :ec) AND DEDUCTION_ID = :did
                         AND "PERIOD#" = :p AND UNIT_ID = :u""",
                    {"e": link, "ec": str(empcode), "did": str(deduction_id).strip(), "p": per, "u": u})
        conn.commit()
        if cur.rowcount == 0:
            return {"status": "error", "message": "Entry not found"}
        return {"status": "success"}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


# ════════════════════════════════════════════════════════════════
# 4 — ABSENT DAYS  (HR_ABSENT_DAYS)
# ════════════════════════════════════════════════════════════════

def list_absent_days(compc, period=None, empcode=None, brnch=None) -> list:
    """Absent-day records for the open period. Each row carries employee info."""
    conn = get_connection(); cur = conn.cursor()
    try:
        u = _int(compc)
        per, _rule = _resolve_period(cur, u, period)
        if per is None:
            return []
        conds = ['a.UNIT_ID = :u', 'a."PERIOD#" = :p']
        params = {"u": u, "p": per}
        if empcode:
            link = _emp_link(cur, str(empcode))
            conds.append("(a.OLD_EMPCODE = :e OR a.OLD_EMPCODE = :ec)")
            params["e"] = link; params["ec"] = str(empcode)
        where = " AND ".join(conds)
        cur.execute(f"""
            SELECT a.OLD_EMPCODE, NVL(a.ABSENT_DAYS,0),
                   {_EMP_COLS.format(alias="a")},
                   (SELECT MAX(e.LOCATION) FROM HR_EMP_MASTER e WHERE e.OLD_EMPCODE = a.OLD_EMPCODE OR e.EMPCODE = a.OLD_EMPCODE)
            FROM HR_ABSENT_DAYS a
            WHERE {where}
            ORDER BY 4
        """, params)
        b = _s(brnch)
        out = []
        for r in cur.fetchall():
            loc = (r[6] or "").strip() if r[6] else ""
            if b and loc != b:
                continue
            out.append({
                "old_empcode": (r[0] or "").strip(), "absent_days": float(r[1] or 0),
                "name": (r[2] or "").strip(), "empcode": (r[3] or r[0] or "").strip(),
                "designation": (r[4] or "").strip(), "department": (r[5] or "").strip(),
            })
        return out
    finally:
        cur.close(); conn.close()


def get_employee_absent(compc, empcode, period=None) -> dict:
    """Current absent days for one employee in the open period (0 if none)."""
    conn = get_connection(); cur = conn.cursor()
    try:
        u = _int(compc)
        per, _rule = _resolve_period(cur, u, period)
        if per is None:
            return {"absent_days": 0, "period": None}
        link = _emp_link(cur, str(empcode))
        cur.execute("""SELECT NVL(ABSENT_DAYS,0) FROM HR_ABSENT_DAYS
                       WHERE (OLD_EMPCODE = :e OR OLD_EMPCODE = :ec) AND UNIT_ID = :u AND "PERIOD#" = :p""",
                    {"e": link, "ec": str(empcode), "u": u, "p": per})
        r = cur.fetchone()
        return {"absent_days": float(r[0]) if r else 0, "period": per}
    finally:
        cur.close(); conn.close()


def set_absent_days(compc, empcode, absent_days, period=None, usr=None) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        u = _int(compc)
        if not _s(empcode):
            return {"status": "error", "message": "Employee is required"}
        days = _num(absent_days)
        if days is None or days < 0:
            return {"status": "error", "message": "Absent days must be zero or more"}
        per, _rule = _resolve_period(cur, u, period)
        if per is None:
            return {"status": "error", "message": "No open period for this company. Open a period first."}
        link = _emp_link(cur, str(empcode))
        cur.execute("""
            MERGE INTO HR_ABSENT_DAYS t
            USING (SELECT :e AS OLD_EMPCODE, :u AS UNIT_ID, :p AS PNO FROM dual) s
            ON (t.OLD_EMPCODE = s.OLD_EMPCODE AND t.UNIT_ID = s.UNIT_ID AND t."PERIOD#" = s.PNO)
            WHEN MATCHED THEN UPDATE SET t.ABSENT_DAYS = :days, t.USR_ID_UPD = :usr, t.USR_DATE_UPD = SYSDATE
            WHEN NOT MATCHED THEN INSERT
              (OLD_EMPCODE, UNIT_ID, "PERIOD#", ABSENT_DAYS, USR_ID_UPD, USR_DATE_UPD)
              VALUES (:e, :u, :p, :days, :usr, SYSDATE)
        """, {"e": link, "u": u, "p": per, "days": days, "usr": (_s(usr) or "HR")[:2]})
        conn.commit()
        return {"status": "success", "period": per, "absent_days": days}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


def delete_absent_days(compc, empcode, period=None) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        u = _int(compc)
        per, _rule = _resolve_period(cur, u, period)
        if per is None:
            return {"status": "error", "message": "No open period for this company."}
        link = _emp_link(cur, str(empcode))
        cur.execute("""DELETE FROM HR_ABSENT_DAYS
                       WHERE (OLD_EMPCODE = :e OR OLD_EMPCODE = :ec) AND UNIT_ID = :u AND "PERIOD#" = :p""",
                    {"e": link, "ec": str(empcode), "u": u, "p": per})
        conn.commit()
        if cur.rowcount == 0:
            return {"status": "error", "message": "Entry not found"}
        return {"status": "success"}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()
