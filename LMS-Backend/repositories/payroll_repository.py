"""Payroll repository — Period Opening, Tax Slabs and Loans.

Scope:
  - Financial years (HR_FINANCIAL_YEAR), monthly periods (HR_ATTND_PERIOD) and
    loans (HR_LOAN_MST) are per-company (UNIT_ID).
  - Tax masters/details (HR_TAX_MST / HR_TAX_DTL) and loan types (HR_LOAN_TYPE)
    are global.
IDs are generated with MAX+1 (no sequences), matching the rest of the app.
"""

from datetime import date

from core.database import get_connection


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


def _d(v):
    """Return 'YYYY-MM-DD' string or None (SQL uses TO_DATE)."""
    return _s(str(v)[:10]) if v else None


# ════════════════════════════════════════════════════════════════
# MODULE 1 — PERIOD OPENING (financial years + monthly periods)
# ════════════════════════════════════════════════════════════════

def list_financial_years(compc=None) -> list:
    conn = get_connection(); cur = conn.cursor()
    try:
        params = {}
        where = ""
        c = _int(compc)
        if c is not None:
            where = "WHERE UNIT_ID = :u"; params["u"] = c
        cur.execute(f"""
            SELECT RULE_ID, TO_CHAR(FROM_DATE,'YYYY-MM-DD'), TO_CHAR(TO_DATE,'YYYY-MM-DD'),
                   STATUS, SCODE, DESCR, RATE, INTRST, FILER, NONFILER, UNIT_ID
            FROM HR_FINANCIAL_YEAR {where} ORDER BY FROM_DATE DESC, RULE_ID DESC
        """, params)
        return [{
            "rule_id": int(r[0]), "from_date": r[1], "to_date": r[2],
            "status": (r[3] or "").strip(), "scode": (r[4] or "").strip(),
            "descr": (r[5] or "").strip(), "rate": r[6], "intrst": r[7],
            "filer": r[8], "nonfiler": r[9], "unit_id": r[10],
        } for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


def _months_between(from_str: str, to_str: str):
    """Yield (year, month) for each calendar month from from_date's month to
    to_date's month inclusive."""
    fy, fm = int(from_str[0:4]), int(from_str[5:7])
    ty, tm = int(to_str[0:4]), int(to_str[5:7])
    y, m = fy, fm
    while (y, m) <= (ty, tm):
        yield y, m
        m += 1
        if m > 12:
            m = 1; y += 1


def _month_bounds(y: int, m: int):
    first = date(y, m, 1)
    last = date(y + (1 if m == 12 else 0), 1 if m == 12 else m + 1, 1)
    from datetime import timedelta
    last = last - timedelta(days=1)
    return first.isoformat(), last.isoformat(), (last - first).days + 1


def _generate_periods(cur, rule_id: int, from_date: str, to_date: str, scode: str, compc, usr) -> int:
    """Auto-create one HR_ATTND_PERIOD per calendar month in the year's range."""
    cur.execute("SELECT NVL(MAX(\"PERIOD#\"), 0) FROM HR_ATTND_PERIOD")
    pno = int(cur.fetchone()[0])
    created = 0
    for y, m in _months_between(from_date, to_date):
        pfrm, pto, pdays = _month_bounds(y, m)
        pno += 1
        cur.execute("""
            INSERT INTO HR_ATTND_PERIOD
              (RULE_ID, "PERIOD#", PERIOD_FRM, PERIOD_TO, STATUS, BLOCK_FLAG,
               UNIT_ID, USR_ID_UPD, USR_DATE_UPD, P_DAYS, SCODE)
            VALUES (:r, :pno, TO_DATE(:pf,'YYYY-MM-DD'), TO_DATE(:pt,'YYYY-MM-DD'),
                    'O', 'N', :u, :usr, SYSDATE, :pd, :sc)
        """, {"r": rule_id, "pno": pno, "pf": pfrm, "pt": pto,
              "u": compc, "usr": usr, "pd": pdays, "sc": (scode or str(y))[:10]})
        created += 1
    return created


def create_financial_year(from_date, to_date, scode, descr, compc, usr=None,
                          rate=None, intrst=None, filer=None, nonfiler=None,
                          auto_periods=True) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        fd, td = _d(from_date), _d(to_date)
        if not fd or not td:
            return {"status": "error", "message": "From and To dates are required"}
        c = _int(compc) or 1
        cur.execute("SELECT NVL(MAX(RULE_ID), 0) + 1 FROM HR_FINANCIAL_YEAR")
        rule_id = int(cur.fetchone()[0])
        cur.execute("""
            INSERT INTO HR_FINANCIAL_YEAR
              (RULE_ID, FROM_DATE, TO_DATE, STATUS, UNIT_ID, USR_ID_UPD, USR_DATE_UPD,
               SCODE, DESCR, RATE, INTRST, FILER, NONFILER)
            VALUES (:rid, TO_DATE(:fd,'YYYY-MM-DD'), TO_DATE(:td,'YYYY-MM-DD'), 'O',
                    :u, :usr, SYSDATE, :sc, :descr, :rate, :intrst, :filer, :nonfiler)
        """, {"rid": rule_id, "fd": fd, "td": td, "u": c, "usr": _s(usr),
              "sc": _s(scode), "descr": _s(descr), "rate": _num(rate), "intrst": _num(intrst),
              "filer": _num(filer), "nonfiler": _num(nonfiler)})
        n = _generate_periods(cur, rule_id, fd, td, scode, c, _s(usr)) if auto_periods else 0
        conn.commit()
        return {"status": "success", "rule_id": rule_id, "periods_created": n}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


def update_financial_year(rule_id, from_date=None, to_date=None, scode=None, descr=None,
                          rate=None, intrst=None, filer=None, nonfiler=None) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        sets, params = [], {"rid": _int(rule_id)}
        for key, col, val, isdate in [
            ("scode", "SCODE", _s(scode), False), ("descr", "DESCR", _s(descr), False),
            ("rate", "RATE", _num(rate), False), ("intrst", "INTRST", _num(intrst), False),
            ("filer", "FILER", _num(filer), False), ("nonfiler", "NONFILER", _num(nonfiler), False),
            ("fd", "FROM_DATE", _d(from_date), True), ("td", "TO_DATE", _d(to_date), True),
        ]:
            if val is None:
                continue
            if isdate:
                sets.append(f"{col} = TO_DATE(:{key},'YYYY-MM-DD')")
            else:
                sets.append(f"{col} = :{key}")
            params[key] = val
        if not sets:
            return {"status": "error", "message": "Nothing to update"}
        cur.execute(f"UPDATE HR_FINANCIAL_YEAR SET {', '.join(sets)} WHERE RULE_ID = :rid", params)
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


def set_financial_year_status(rule_id, status) -> dict:
    st = "O" if str(status).upper().startswith("O") else "C"
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute("UPDATE HR_FINANCIAL_YEAR SET STATUS = :s, USR_DATE_UPD = SYSDATE WHERE RULE_ID = :r",
                    {"s": st, "r": _int(rule_id)})
        conn.commit()
        return {"status": "success", "new_status": st}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


def list_periods(compc=None, rule_id=None) -> list:
    conn = get_connection(); cur = conn.cursor()
    try:
        conds, params = [], {}
        c = _int(compc)
        if c is not None:
            conds.append("UNIT_ID = :u"); params["u"] = c
        r = _int(rule_id)
        if r is not None:
            conds.append("RULE_ID = :r"); params["r"] = r
        where = ("WHERE " + " AND ".join(conds)) if conds else ""
        cur.execute(f"""
            SELECT "PERIOD#", RULE_ID, TO_CHAR(PERIOD_FRM,'YYYY-MM-DD'),
                   TO_CHAR(PERIOD_TO,'YYYY-MM-DD'), STATUS, BLOCK_FLAG, P_DAYS, SCODE, UNIT_ID
            FROM HR_ATTND_PERIOD {where} ORDER BY PERIOD_FRM, "PERIOD#"
        """, params)
        return [{
            "period": int(r[0]), "rule_id": r[1], "period_frm": r[2], "period_to": r[3],
            "status": (r[4] or "").strip(), "block_flag": (r[5] or "").strip(),
            "p_days": r[6], "scode": (r[7] or "").strip(), "unit_id": r[8],
        } for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


def create_period(rule_id, period_frm, period_to, scode, compc, usr=None) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        pf, pt = _d(period_frm), _d(period_to)
        if not pf or not pt:
            return {"status": "error", "message": "Period from/to dates are required"}
        c = _int(compc) or 1
        cur.execute("SELECT NVL(MAX(\"PERIOD#\"), 0) + 1 FROM HR_ATTND_PERIOD")
        pno = int(cur.fetchone()[0])
        pdays = (date.fromisoformat(pt) - date.fromisoformat(pf)).days + 1
        cur.execute("""
            INSERT INTO HR_ATTND_PERIOD
              (RULE_ID, "PERIOD#", PERIOD_FRM, PERIOD_TO, STATUS, BLOCK_FLAG,
               UNIT_ID, USR_ID_UPD, USR_DATE_UPD, P_DAYS, SCODE)
            VALUES (:r, :pno, TO_DATE(:pf,'YYYY-MM-DD'), TO_DATE(:pt,'YYYY-MM-DD'),
                    'O', 'N', :u, :usr, SYSDATE, :pd, :sc)
        """, {"r": _int(rule_id), "pno": pno, "pf": pf, "pt": pt, "u": c,
              "usr": _s(usr), "pd": pdays, "sc": (_s(scode) or "")[:10]})
        conn.commit()
        return {"status": "success", "period": pno}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


def set_period_status(period, status, block=None) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        sets, params = [], {"p": _int(period)}
        if status is not None:
            sets.append("STATUS = :s"); params["s"] = "O" if str(status).upper().startswith("O") else "C"
        if block is not None:
            sets.append("BLOCK_FLAG = :b"); params["b"] = "Y" if str(block).upper().startswith(("Y", "T", "1")) else "N"
        if not sets:
            return {"status": "error", "message": "Nothing to update"}
        sets.append("USR_DATE_UPD = SYSDATE")
        cur.execute(f"UPDATE HR_ATTND_PERIOD SET {', '.join(sets)} WHERE \"PERIOD#\" = :p", params)
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


# ════════════════════════════════════════════════════════════════
# MODULE 2 — TAX SLABS (global)
# ════════════════════════════════════════════════════════════════

def list_tax_masters() -> list:
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT TAX_ID, TAX_DESC, FYEAR, STATUS,
                   (SELECT COUNT(*) FROM HR_TAX_DTL d WHERE d.TAX_ID = m.TAX_ID) AS slabs
            FROM HR_TAX_MST m ORDER BY TAX_ID DESC
        """)
        return [{"tax_id": int(r[0]), "tax_desc": (r[1] or "").strip(),
                 "fyear": (r[2] or "").strip(), "status": (r[3] or "").strip(),
                 "slabs": int(r[4] or 0)} for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


def create_tax_master(tax_desc, fyear, usr=None) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute("SELECT NVL(MAX(TAX_ID), 0) + 1 FROM HR_TAX_MST")
        tax_id = int(cur.fetchone()[0])
        cur.execute("""
            INSERT INTO HR_TAX_MST (TAX_ID, TAX_DESC, FYEAR, STATUS, USER_ID_UPD, USER_DATE_UPD)
            VALUES (:id, :d, :f, 'O', :usr, SYSDATE)
        """, {"id": tax_id, "d": _s(tax_desc), "f": _s(fyear), "usr": _s(usr)})
        conn.commit()
        return {"status": "success", "tax_id": tax_id}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


def set_tax_master_status(tax_id, status) -> dict:
    st = "O" if str(status).upper().startswith("O") else "C"
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute("UPDATE HR_TAX_MST SET STATUS = :s, USER_DATE_UPD = SYSDATE WHERE TAX_ID = :id",
                    {"s": st, "id": _int(tax_id)})
        conn.commit()
        return {"status": "success", "new_status": st}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


def delete_tax_master(tax_id) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        tid = _int(tax_id)
        cur.execute("DELETE FROM HR_TAX_DTL WHERE TAX_ID = :id", {"id": tid})
        cur.execute("DELETE FROM HR_TAX_MST WHERE TAX_ID = :id", {"id": tid})
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


def list_tax_details(tax_id) -> list:
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT TAX_ID, SRNO, SLAB_FROM, SLAB_TO, SLAB_RATE,
                   TO_CHAR(DATE_FROM,'YYYY-MM-DD'), TO_CHAR(DATE_TO,'YYYY-MM-DD'),
                   SLAB_DED, FIXED_TAX
            FROM HR_TAX_DTL WHERE TAX_ID = :id ORDER BY SLAB_FROM, SRNO
        """, {"id": _int(tax_id)})
        return [{"tax_id": int(r[0]), "srno": int(r[1]) if r[1] is not None else None,
                 "slab_from": r[2], "slab_to": r[3], "slab_rate": r[4],
                 "date_from": r[5], "date_to": r[6], "slab_ded": r[7], "fixed_tax": r[8]}
                for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


def add_tax_detail(tax_id, slab_from, slab_to, slab_rate, date_from, date_to,
                   slab_ded, fixed_tax, usr=None) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute("SELECT NVL(MAX(SRNO), 0) + 1 FROM HR_TAX_DTL")
        srno = int(cur.fetchone()[0])
        cur.execute("""
            INSERT INTO HR_TAX_DTL
              (TAX_ID, SRNO, SLAB_FROM, SLAB_TO, SLAB_RATE, DATE_FROM, DATE_TO,
               SLAB_DED, FIXED_TAX, USER_ID_UPD, USER_DATE_UPD)
            VALUES (:t, :sr, :sf, :st, :rate,
                    TO_DATE(:df,'YYYY-MM-DD'), TO_DATE(:dt,'YYYY-MM-DD'),
                    :ded, :fix, :usr, SYSDATE)
        """, {"t": _int(tax_id), "sr": srno, "sf": _num(slab_from), "st": _num(slab_to),
              "rate": _num(slab_rate), "df": _d(date_from), "dt": _d(date_to),
              "ded": _num(slab_ded), "fix": _num(fixed_tax), "usr": _s(usr)})
        conn.commit()
        return {"status": "success", "srno": srno}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


def delete_tax_detail(tax_id, srno) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM HR_TAX_DTL WHERE TAX_ID = :t AND SRNO = :s",
                    {"t": _int(tax_id), "s": _int(srno)})
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


# ════════════════════════════════════════════════════════════════
# MODULE 3 — LOANS
# ════════════════════════════════════════════════════════════════

def list_loan_types() -> list:
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute("SELECT LOAN_CD, LOAN_DESC FROM HR_LOAN_TYPE WHERE LOAN_CD IS NOT NULL ORDER BY LOAN_DESC")
        return [{"loan_cd": (r[0] or "").strip(), "loan_desc": (r[1] or "").strip()} for r in cur.fetchall()]
    finally:
        cur.close(); conn.close()


def add_loan_type(loan_desc, usr=None) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute("SELECT NVL(MAX(TO_NUMBER(LOAN_CD)), 0) + 1 FROM HR_LOAN_TYPE WHERE REGEXP_LIKE(LOAN_CD, '^[0-9]+$')")
        cd = str(int(cur.fetchone()[0]))
        cur.execute("INSERT INTO HR_LOAN_TYPE (LOAN_CD, LOAN_DESC, USR_ID_UPD, USR_DATE_UPD) VALUES (:c, :d, :usr, SYSDATE)",
                    {"c": cd, "d": _s(loan_desc), "usr": _s(usr)})
        conn.commit()
        return {"status": "success", "loan_cd": cd, "loan_desc": _s(loan_desc)}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


def delete_loan_type(loan_cd) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute("DELETE FROM HR_LOAN_TYPE WHERE LOAN_CD = :c", {"c": str(loan_cd)})
        conn.commit()
        if cur.rowcount == 0:
            return {"status": "error", "message": "Loan type not found"}
        return {"status": "success"}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


def _emp_link(cur, empcode: str) -> str:
    """Resolve the value to store in HR_LOAN_MST.OLD_EMPCODE for an employee —
    prefer their OLD_EMPCODE, else the empcode itself."""
    try:
        cur.execute("SELECT OLD_EMPCODE FROM HR_EMP_MASTER WHERE EMPCODE = :e", {"e": empcode})
        r = cur.fetchone()
        if r and r[0]:
            return str(r[0]).strip()
    except Exception:
        pass
    return str(empcode)


def list_loans(compc=None, empcode=None) -> list:
    conn = get_connection(); cur = conn.cursor()
    try:
        conds, params = [], {}
        c = _int(compc)
        if c is not None:
            conds.append("l.UNIT_ID = :u"); params["u"] = c
        if empcode:
            link = _emp_link(cur, str(empcode))
            conds.append("(l.OLD_EMPCODE = :e OR l.OLD_EMPCODE = :ec)")
            params["e"] = link; params["ec"] = str(empcode)
        where = ("WHERE " + " AND ".join(conds)) if conds else ""
        sql = f"""
            SELECT l."DOC#", l.OLD_EMPCODE, m.NAME, l.LOAN_CD, t.LOAN_DESC,
                   NVL(dep.DEPT_NAME, TO_CHAR(m.DEPT_NO)) AS DEPT_NAME,
                   TO_CHAR(l.LOAN_DATE,'YYYY-MM-DD'), l.LOAN_AMT, l.INSTALMENT_AMT,
                   l.NOF_INSTALMENT, NVL(l.LOAN_RECOVER,0),
                   TO_CHAR(l.START_DT,'YYYY-MM-DD'), l.CHARGE_INT, l.INT_RATE,
                   l.CHQ_NO, TO_CHAR(l.CHQ_DT,'YYYY-MM-DD'), l.REMARKS, l.UNIT_ID
            FROM HR_LOAN_MST l
            LEFT JOIN HR_EMP_MASTER m ON (m.OLD_EMPCODE = l.OLD_EMPCODE OR m.EMPCODE = l.OLD_EMPCODE)
            LEFT JOIN HR_LOAN_TYPE t ON t.LOAN_CD = l.LOAN_CD
            LEFT JOIN (SELECT DEPT_NO, MIN(DEPT_NAME) AS DEPT_NAME FROM HR_DEPT GROUP BY DEPT_NO) dep
                   ON dep.DEPT_NO = m.DEPT_NO
            {where}
            ORDER BY l."DOC#" DESC
        """
        try:
            cur.execute(sql, params)
        except Exception as e:
            # Department join can fail on odd data types — retry without it.
            if "ORA-" not in str(e):
                raise
            sql2 = sql.replace("NVL(dep.DEPT_NAME, TO_CHAR(m.DEPT_NO)) AS DEPT_NAME", "TO_CHAR(m.DEPT_NO) AS DEPT_NAME")
            sql2 = sql2.replace(
                "LEFT JOIN (SELECT DEPT_NO, MIN(DEPT_NAME) AS DEPT_NAME FROM HR_DEPT GROUP BY DEPT_NO) dep\n                   ON dep.DEPT_NO = m.DEPT_NO", "")
            cur.execute(sql2, params)
        rows = cur.fetchall()
        out = []
        for r in rows:
            amt = float(r[7] or 0); rec = float(r[10] or 0)
            out.append({
                "doc": int(r[0]), "old_empcode": (r[1] or "").strip(), "name": (r[2] or "").strip(),
                "loan_cd": (r[3] or "").strip(), "loan_desc": (r[4] or "").strip(),
                "dept_name": (r[5] or "").strip(), "loan_date": r[6], "loan_amt": amt,
                "instalment_amt": r[8], "nof_instalment": r[9], "loan_recover": rec,
                "balance": amt - rec, "start_dt": r[11], "charge_int": (r[12] or "").strip(),
                "int_rate": r[13], "chq_no": (r[14] or "").strip(), "chq_dt": r[15],
                "remarks": (r[16] or "").strip(), "unit_id": r[17],
            })
        return out
    finally:
        cur.close(); conn.close()


def create_loan(empcode, loan_cd, loan_date, loan_amt, instalment_amt, nof_instalment,
                start_dt, charge_int, int_rate, chq_no, chq_dt, remarks, compc, usr=None) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        if not _s(empcode):
            return {"status": "error", "message": "Employee is required"}
        c = _int(compc) or 1
        link = _emp_link(cur, str(empcode))
        cur.execute("SELECT NVL(MAX(\"DOC#\"), 0) + 1 FROM HR_LOAN_MST")
        doc = int(cur.fetchone()[0])
        ld = _d(loan_date) or date.today().isoformat()
        cur.execute("""
            INSERT INTO HR_LOAN_MST
              ("DOC#", DOC_DT, UNIT_ID, OLD_EMPCODE, LOAN_CD, LOAN_DATE, LOAN_AMT,
               LOAN_RECOVER, INSTALMENT_AMT, NOF_INSTALMENT, START_DT, CHARGE_INT,
               INT_RATE, USR_ID_UPD, USR_DATE_UPD, REMARKS, CHQ_NO, CHQ_DT)
            VALUES (:doc, TO_DATE(:ld,'YYYY-MM-DD'), :u, :emp, :lc, TO_DATE(:ld,'YYYY-MM-DD'),
                    :amt, 0, :inst, :nof, TO_DATE(:sd,'YYYY-MM-DD'), :ci, :ir, :usr, SYSDATE,
                    :rem, :chq, TO_DATE(:chqd,'YYYY-MM-DD'))
        """, {"doc": doc, "ld": ld, "u": c, "emp": link, "lc": _s(loan_cd),
              "amt": _num(loan_amt), "inst": _num(instalment_amt), "nof": _int(nof_instalment),
              "sd": _d(start_dt) or ld, "ci": "Y" if str(charge_int).upper().startswith("Y") else "N",
              "ir": _num(int_rate), "usr": _s(usr), "rem": _s(remarks),
              "chq": _s(chq_no), "chqd": _d(chq_dt)})
        conn.commit()
        return {"status": "success", "doc": doc}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


def update_loan(doc, loan_cd=None, loan_date=None, loan_amt=None, instalment_amt=None,
                nof_instalment=None, start_dt=None, charge_int=None, int_rate=None,
                chq_no=None, chq_dt=None, remarks=None) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        sets, params = [], {"doc": _int(doc)}
        for key, col, val in [
            ("lc", "LOAN_CD", _s(loan_cd)), ("amt", "LOAN_AMT", _num(loan_amt)),
            ("inst", "INSTALMENT_AMT", _num(instalment_amt)), ("nof", "NOF_INSTALMENT", _int(nof_instalment)),
            ("ir", "INT_RATE", _num(int_rate)), ("rem", "REMARKS", _s(remarks)),
            ("chq", "CHQ_NO", _s(chq_no)),
        ]:
            if val is not None:
                sets.append(f"{col} = :{key}"); params[key] = val
        if charge_int is not None:
            sets.append("CHARGE_INT = :ci"); params["ci"] = "Y" if str(charge_int).upper().startswith("Y") else "N"
        for key, col, val in [("ld", "LOAN_DATE", _d(loan_date)), ("sd", "START_DT", _d(start_dt)),
                              ("chqd", "CHQ_DT", _d(chq_dt))]:
            if val is not None:
                sets.append(f"{col} = TO_DATE(:{key},'YYYY-MM-DD')"); params[key] = val
        if not sets:
            return {"status": "error", "message": "Nothing to update"}
        sets.append("USR_DATE_UPD = SYSDATE")
        cur.execute(f"UPDATE HR_LOAN_MST SET {', '.join(sets)} WHERE \"DOC#\" = :doc", params)
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()


def delete_loan(doc, compc=None) -> dict:
    conn = get_connection(); cur = conn.cursor()
    try:
        params = {"doc": _int(doc)}
        where = "\"DOC#\" = :doc"
        c = _int(compc)
        if c is not None:
            where += " AND UNIT_ID = :u"; params["u"] = c
        cur.execute(f"DELETE FROM HR_LOAN_MST WHERE {where}", params)
        conn.commit()
        if cur.rowcount == 0:
            return {"status": "error", "message": "Loan not found"}
        return {"status": "success"}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cur.close(); conn.close()
