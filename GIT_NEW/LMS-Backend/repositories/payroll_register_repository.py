"""Pay Register report — read-only from the ERP view HR_PAY_REG_V.

Each (employee, period) has several rows in HR_PAY_REG_V:
  trans_type 'A' = earning/allowance components (BASIC, HOUSE RENT, …) + a
                   TOT_ALL marker row (total allowances),
  trans_type 'D' = deduction components (ADVANCE SALARY, LOAN, …) + a TOT_DED
                   marker row (total deductions),
  trans_type 'X' / descr 'NET' = net pay.
The header fields (w_day, gross/basic, hold_sal) repeat on every row. This
pivots those rows into one record per employee with dynamic allowance and
deduction columns (the component set differs per unit).
"""

from core.database import get_connection


_BASE_SQL = """
SELECT b.UNIT_NAME,
       codename('LOCATION', a.location, a.unit_id)  AS loc_name,
       codename('DEPT_NO',  a.dept_no,  a.unit_id)  AS dep_name,
       codename('DESG_CD',  a.desg_cd,  a.unit_id)  AS desg_name,
       a.old_empcode, b.NAME,
       a.w_day, a.absent_days,
       a.actual_gross, a.actual_basic, a.earned_gross, a.earned_basic,
       a.trans_type, a.period#,
       codename('PERIOD#', a.period#, a.unit_id)    AS period_name,
       a.hold_sal, a.trans_id, a.descr, a.amont,
       a.location, a.dept_no, a.desg_cd
  FROM HR_PAY_REG_V a, hr_emp_master_view b
 WHERE a.old_empcode = b.OLD_EMPCODE
   AND a.unit_id = b.UNIT_ID
   AND a.unit_id = :unit_id
   AND a.period# = :period
   AND NVL(a.amont, 0) <> 0
   {filters}
 ORDER BY loc_name, dep_name, b.NAME, a.old_empcode, a.trans_type, a.trans_id
"""


def get_pay_register_periods(unit_id) -> list:
    """Distinct pay periods available in HR_PAY_REG_V for the unit (newest first)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT period#, codename('PERIOD#', period#, unit_id) AS period_name
            FROM HR_PAY_REG_V
            WHERE unit_id = :u AND NVL(amont, 0) <> 0
            GROUP BY period#, codename('PERIOD#', period#, unit_id)
            ORDER BY period# DESC
        """, {"u": int(unit_id)})
        return [{"period": int(r[0]), "label": (r[1] or "").strip()} for r in cursor.fetchall()]
    finally:
        cursor.close()
        conn.close()


def get_pay_register(unit_id, period, location=None, dept_no=None,
                     desg_cd=None, empcode=None) -> dict:
    """Pivoted pay register for a unit + period, optionally narrowed by
    location / department / designation / employee."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        filters = ""
        binds = {"unit_id": int(unit_id), "period": int(period)}
        if location:
            filters += " AND a.location = :location"; binds["location"] = str(location)
        if dept_no:
            filters += " AND a.dept_no = :dept_no";   binds["dept_no"] = str(dept_no)
        if desg_cd:
            filters += " AND a.desg_cd = :desg_cd";   binds["desg_cd"] = str(desg_cd)
        if empcode:
            filters += " AND a.old_empcode = :empcode"; binds["empcode"] = str(empcode)

        cursor.execute(_BASE_SQL.replace("{filters}", filters), binds)
        cols = [d[0].lower() for d in cursor.description]
        rows = [dict(zip(cols, r)) for r in cursor.fetchall()]

        emps = {}          # old_empcode -> record
        order = []         # preserve query order
        allow_cols = {}    # descr -> trans_id (for column ordering)
        ded_cols = {}
        unit_name = ""
        period_name = ""

        def _s(v):
            return v.strip() if isinstance(v, str) else (v or "")

        for r in rows:
            unit_name = unit_name or _s(r.get("unit_name"))
            period_name = period_name or _s(r.get("period_name"))
            ec = r["old_empcode"]
            if ec not in emps:
                emps[ec] = {
                    "old_empcode": ec,
                    "name": _s(r.get("name")),
                    "location": _s(r.get("loc_name")),
                    "department": _s(r.get("dep_name")),
                    "designation": _s(r.get("desg_name")),
                    "w_day": r.get("w_day"),
                    "absent_days": r.get("absent_days"),
                    "actual_gross": r.get("actual_gross"),
                    "actual_basic": r.get("actual_basic"),
                    "earned_gross": r.get("earned_gross"),
                    "earned_basic": r.get("earned_basic"),
                    "hold_sal": _s(r.get("hold_sal")),
                    "allows": {},
                    "deds": {},
                    "tot_all": 0,
                    "tot_ded": 0,
                    "net": 0,
                }
                order.append(ec)
            e = emps[ec]
            tt = _s(r.get("trans_type")).upper()
            descr = _s(r.get("descr"))
            amt = r.get("amont") or 0
            tid = r.get("trans_id")

            if descr == "TOT_ALL":
                e["tot_all"] = amt
            elif descr == "TOT_DED":
                e["tot_ded"] = amt
            elif descr == "NET" or tt == "X":
                e["net"] = amt
            elif tt == "A":
                e["allows"][descr] = e["allows"].get(descr, 0) + amt
                allow_cols.setdefault(descr, tid)
            elif tt == "D":
                e["deds"][descr] = e["deds"].get(descr, 0) + amt
                ded_cols.setdefault(descr, tid)

        def _order_cols(d):
            def key(item):
                descr, tid = item
                try:
                    return (int(tid), descr)
                except (ValueError, TypeError):
                    return (9999, descr)
            return [descr for descr, _ in sorted(d.items(), key=key)]

        return {
            "unit_name": unit_name,
            "period": int(period),
            "period_name": period_name,
            "allow_cols": _order_cols(allow_cols),
            "ded_cols": _order_cols(ded_cols),
            "employees": [emps[ec] for ec in order],
        }
    finally:
        cursor.close()
        conn.close()
