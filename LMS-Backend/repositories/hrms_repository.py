"""HRMS repository — CRUD on HR_EMP_MASTER + HR dashboard queries."""

from core.database import get_connection


def _to_int(v):
    """Parse any numeric-ish value to int, handling Oracle decimals like '2.0'."""
    try:
        return int(float(str(v).strip()))
    except (ValueError, TypeError):
        return None


# ------------------------------------------------------------------
# NEXT EMPCODE — auto-increment
# ------------------------------------------------------------------

def get_next_empcode() -> str:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT MAX(TO_NUMBER(REGEXP_REPLACE(EMPCODE, '[^0-9]', '')))
            FROM HR_EMP_MASTER
            WHERE REGEXP_LIKE(EMPCODE, '^[0-9]+$')
        """)
        row = cursor.fetchone()
        max_val = int(row[0]) if row and row[0] else 0
        return str(max_val + 1)
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# CREATE EMPLOYEE
# ------------------------------------------------------------------

def _str_or_none(val):
    """Return None if val is None or empty string, else the string."""
    if val is None or str(val).strip() == "":
        return None
    return val


def _num_or_none(val):
    """Return None if val is None or empty string, else convert to number."""
    if val is None or str(val).strip() == "":
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        try:
            return float(val)
        except (ValueError, TypeError):
            return None


def _save_qualification_detail(cursor, conn, empcode: str, data: dict) -> None:
    """Best-effort upsert of the profile Qualification + Qualification Detail into a
    dedicated Q_TYPE='PR' row in HR_EMP_QUALIFICATION. Never touches the employee's
    real qualification records (other Q_TYPE values). Non-fatal on any error."""
    qual = _str_or_none(data.get("qfication"))
    detail = _str_or_none(data.get("qual_detail"))
    if qual is None and detail is None:
        return
    try:
        cursor.execute("SELECT OLD_EMPCODE, UNIT_ID FROM HR_EMP_MASTER WHERE EMPCODE = :e",
                       {"e": empcode})
        r = cursor.fetchone()
        old_emp = r[0] if r else None
        unit_id = r[1] if r else None
        cursor.execute("""
            UPDATE HR_EMP_QUALIFICATION SET DESCR = :q, INTITUTE = :d
            WHERE Q_TYPE = 'PR'
              AND (EMPCODE = :e OR (:o IS NOT NULL AND OLD_EMPCODE = :o))
        """, {"q": qual, "d": detail, "e": empcode, "o": old_emp})
        if cursor.rowcount == 0:
            cursor.execute("""
                INSERT INTO HR_EMP_QUALIFICATION (EMPCODE, OLD_EMPCODE, UNIT_ID, Q_TYPE, DESCR, INTITUTE)
                VALUES (:e, :o, :u, 'PR', :q, :d)
            """, {"e": empcode, "o": old_emp, "u": unit_id, "q": qual, "d": detail})
        conn.commit()
    except Exception as e:
        try:
            conn.rollback()
        except Exception:
            pass
        print(f"[HRMS] qualification detail save skipped (non-fatal): {str(e).splitlines()[0][:90]}")


def create_employee(data: dict) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        empcode = get_next_empcode()
        cursor.execute("""
            INSERT INTO HR_EMP_MASTER (
                NAME, FHNAME, "ATDTCARD#",
                SEX, DTOFBRTH, NICNO,
                DTOFAPPT, DEPT_NO, DESG_CD,
                "MOBILE#", EMAIL, ADDRESS,
                UNIT_ID, STATUS, USER_PASWD,
                HR_ADMIN, RPT_OFFICER, MARSTAT,
                GRADE_CD, RELIGION,
                HOD1, HOD2, HOD3,
                BASIC, GROSS, SHIFT, W_HOUR, BLDGRP, LOCATION,
                EMP_STATUS, NTN, BNKCODE, BRNCODE, BNKACCT, QFICATION,
                DTOFCONFIRM
            ) VALUES (
                :name, :fhname, :atdtcard,
                :sex,
                CASE WHEN :dtofbrth IS NULL THEN NULL ELSE TO_DATE(:dtofbrth, 'YYYY-MM-DD') END,
                :nicno,
                CASE WHEN :dtofappt IS NULL THEN NULL ELSE TO_DATE(:dtofappt, 'YYYY-MM-DD') END,
                :dept_no, :desg_cd,
                :mobile, :email, :address,
                :unit_id, :status, :user_paswd,
                :hr_admin, :rpt_officer, :marstat,
                :grade_cd, :religion,
                :hod1, :hod2, :hod3,
                :basic, :gross, :shift, :w_hour, :bldgrp, :location,
                :emp_status, :ntn, :bnkcode, :brncode, :bnkacct, :qfication,
                CASE WHEN :dtofconfirm IS NULL THEN NULL ELSE TO_DATE(:dtofconfirm, 'YYYY-MM-DD') END
            )
        """, {
            "name": data.get("name"),
            "fhname": _str_or_none(data.get("fhname")),
            "atdtcard": _str_or_none(data.get("atdtcard")),
            "sex": _str_or_none(data.get("sex")),
            "dtofbrth": _str_or_none(data.get("dtofbrth")),
            "nicno": _str_or_none(data.get("nicno")),
            "dtofappt": _str_or_none(data.get("dtofappt")),
            "dept_no": _num_or_none(data.get("dept_no")),
            "desg_cd": _num_or_none(data.get("desg_cd")),
            "mobile": _str_or_none(data.get("mobile")),
            "email": _str_or_none(data.get("email")),
            "address": _str_or_none(data.get("address")),
            "unit_id": _num_or_none(data.get("unit_id")) or 1,
            "status": data.get("status") or "A",
            "user_paswd": _str_or_none(data.get("user_paswd")),
            "hr_admin": data.get("hr_admin") or "N",
            "rpt_officer": _str_or_none(data.get("rpt_officer")),
            "marstat": _str_or_none(data.get("marstat")),
            "grade_cd": _str_or_none(data.get("grade_cd")),
            "religion": (_str_or_none(data.get("religion")) or "")[:4] or None,
            "hod1": _num_or_none(data.get("hod1")),
            "hod2": _num_or_none(data.get("hod2")),
            "hod3": _num_or_none(data.get("hod3")),
            "basic": _num_or_none(data.get("basic")),
            "gross": _num_or_none(data.get("gross")),
            "shift": _str_or_none(data.get("shift")),
            "w_hour": _num_or_none(data.get("w_hour")),
            "bldgrp": _str_or_none(data.get("bldgrp")),
            "location": _num_or_none(data.get("location")),
            "emp_status": _str_or_none(data.get("emp_status")),
            "ntn": _str_or_none(data.get("ntn")),
            "bnkcode": _str_or_none(data.get("bnkcode")),
            "brncode": _str_or_none(data.get("brncode")),
            "bnkacct": _str_or_none(data.get("bnkacct")),
            "qfication": _str_or_none(data.get("qfication")),
            "dtofconfirm": _str_or_none(data.get("dtofconfirm")),
        })
        conn.commit()
        # Best-effort: persist qualification + detail into HR_EMP_QUALIFICATION.
        _save_qualification_detail(cursor, conn, empcode, data)
        return {"status": "success", "empcode": empcode}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# GET EMPLOYEE BY EMPCODE
# ------------------------------------------------------------------

def get_employee_by_empcode(empcode: str) -> dict | None:
    conn = get_connection()
    cursor = conn.cursor()

    # Extended SELECT (new profile fields + view-only salary from HR_EMP_MASTER_SAL
    # + qualification detail from HR_EMP_QUALIFICATION). Falls back to the base
    # SELECT if any of the extra columns/tables are missing (ORA-00904/942).
    extended_sql = """
            SELECT
                m.EMPCODE, m.NAME, m.FHNAME, m."ATDTCARD#",
                m.SEX,
                TO_CHAR(m.DTOFBRTH, 'YYYY-MM-DD') AS DTOFBRTH,
                m.NICNO,
                TO_CHAR(m.DTOFAPPT, 'YYYY-MM-DD') AS DTOFAPPT,
                m.DEPT_NO, m.DESG_CD,
                m."MOBILE#", m.EMAIL, m.ADDRESS,
                m.UNIT_ID, m.STATUS, m.USER_PASWD,
                m.HR_ADMIN, m.RPT_OFFICER, m.MARSTAT,
                m.GRADE_CD, m.RELIGION,
                m.HOD1, m.HOD2, m.HOD3,
                m.BASIC, m.GROSS, m.SHIFT, m.W_HOUR,
                m.TRACK_LOCATION, m.TRACK_LOCATION_HR,
                m.EMP_STATUS, m.NTN, m.BNKCODE, m.BRNCODE, m.BNKACCT,
                m.QFICATION,
                TO_CHAR(m.DTOFCONFIRM, 'YYYY-MM-DD') AS DTOFCONFIRM,
                (SELECT MAX(s.GROSS) FROM HR_EMP_MASTER_SAL s
                   WHERE s.OLD_EMPCODE = m.OLD_EMPCODE AND s.UNIT_ID = m.UNIT_ID
                     AND s.PERIOD# = (SELECT MAX(s2.PERIOD#) FROM HR_EMP_MASTER_SAL s2
                                       WHERE s2.OLD_EMPCODE = m.OLD_EMPCODE AND s2.UNIT_ID = m.UNIT_ID)
                ) AS SAL_GROSS,
                (SELECT MAX(s.BASIC) FROM HR_EMP_MASTER_SAL s
                   WHERE s.OLD_EMPCODE = m.OLD_EMPCODE AND s.UNIT_ID = m.UNIT_ID
                     AND s.PERIOD# = (SELECT MAX(s2.PERIOD#) FROM HR_EMP_MASTER_SAL s2
                                       WHERE s2.OLD_EMPCODE = m.OLD_EMPCODE AND s2.UNIT_ID = m.UNIT_ID)
                ) AS SAL_BASIC,
                (SELECT MAX(q.INTITUTE) FROM HR_EMP_QUALIFICATION q
                   WHERE q.Q_TYPE = 'PR'
                     AND (q.EMPCODE = m.EMPCODE OR q.OLD_EMPCODE = m.OLD_EMPCODE)
                ) AS QUAL_DETAIL
            FROM HR_EMP_MASTER m
            WHERE m.EMPCODE = :empcode
        """
    base_sql = """
            SELECT
                EMPCODE, NAME, FHNAME, "ATDTCARD#",
                SEX,
                TO_CHAR(DTOFBRTH, 'YYYY-MM-DD') AS DTOFBRTH,
                NICNO,
                TO_CHAR(DTOFAPPT, 'YYYY-MM-DD') AS DTOFAPPT,
                DEPT_NO, DESG_CD,
                "MOBILE#", EMAIL, ADDRESS,
                UNIT_ID, STATUS, USER_PASWD,
                HR_ADMIN, RPT_OFFICER, MARSTAT,
                GRADE_CD, RELIGION,
                HOD1, HOD2, HOD3,
                BASIC, GROSS, SHIFT, W_HOUR,
                TRACK_LOCATION, TRACK_LOCATION_HR
            FROM HR_EMP_MASTER
            WHERE EMPCODE = :empcode
        """
    try:
        try:
            cursor.execute(extended_sql, {"empcode": empcode})
        except Exception as e:
            if "ORA-00904" in str(e) or "ORA-00942" in str(e):
                print(f"[HRMS] employee extended read fell back: {str(e).splitlines()[0][:90]}")
                cursor.execute(base_sql, {"empcode": empcode})
            else:
                raise
        row = cursor.fetchone()
        if not row:
            return None
        columns = [col[0].lower() for col in cursor.description]
        result = dict(zip(columns, row))
        result["atdtcard"] = result.pop("atdtcard#", None)
        result["mobile"] = result.pop("mobile#", None)
        # Normalise the view-only salary aliases.
        result["sal_gross"] = result.get("sal_gross")
        result["sal_basic"] = result.get("sal_basic")
        return result
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# EMPLOYEE ID CARD (resolved names for printing)
# ------------------------------------------------------------------

def get_employee_card(empcode: str) -> dict | None:
    """Return an employee's printable ID-card data with names resolved
    (designation, department, company, branch). Falls back to the base detail
    (codes) if the lookup joins aren't available in this schema."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        try:
            cursor.execute("""
                SELECT
                    m.EMPCODE, m.NAME, m.FHNAME, m."ATDTCARD#", m.NICNO, m."MOBILE#",
                    m.EMAIL, m.SEX, m.BLDGRP, m.STATUS,
                    TO_CHAR(m.DTOFAPPT, 'YYYY-MM-DD') AS DTOFAPPT,
                    (SELECT MIN(dg.DESG_DESC) FROM HR_DESG dg WHERE dg.DESG_CD = m.DESG_CD) AS DESIGNATION,
                    (SELECT MIN(d.DEPT_NAME) FROM HR_DEPT d WHERE d.DEPT_NO = m.DEPT_NO) AS DEPARTMENT,
                    (SELECT u.UNIT_NAME FROM UNIT_MST u WHERE u.UNIT_ID = m.UNIT_ID) AS COMPANY_NAME,
                    (SELECT MIN(l.DESCR) FROM COM_LOCATION l WHERE TRIM(l.LCODE) = TRIM(m.LOCATION)) AS BRANCH_NAME
                FROM HR_EMP_MASTER m
                WHERE m.EMPCODE = :e
            """, {"e": empcode})
            row = cursor.fetchone()
            if not row:
                return None
            cols = [c[0].lower() for c in cursor.description]
            r = dict(zip(cols, row))
            r["atdtcard"] = r.pop("atdtcard#", None)
            r["mobile"] = r.pop("mobile#", None)
            for k in ("name", "designation", "department", "company_name", "branch_name", "nicno"):
                if r.get(k):
                    r[k] = str(r[k]).strip()
            r["card_no"] = r.get("empcode")
            return r
        except Exception as e:
            if "ORA-00904" in str(e) or "ORA-00942" in str(e):
                base = get_employee_by_empcode(empcode)
                if base:
                    base["card_no"] = base.get("empcode")
                return base
            raise
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# UPDATE EMPLOYEE
# ------------------------------------------------------------------

def update_employee(empcode: str, data: dict) -> dict:
    conn = get_connection()
    cursor = conn.cursor()

    field_map = {
        "name": "NAME", "fhname": "FHNAME",
        "sex": "SEX", "nicno": "NICNO", "dept_no": "DEPT_NO",
        "desg_cd": "DESG_CD", "mobile": '"MOBILE#"', "email": "EMAIL",
        "address": "ADDRESS", "unit_id": "UNIT_ID", "status": "STATUS",
        "user_paswd": "USER_PASWD", "hr_admin": "HR_ADMIN",
        "rpt_officer": "RPT_OFFICER", "marstat": "MARSTAT",
        "grade_cd": "GRADE_CD", "religion": "RELIGION",
        "hod1": "HOD1", "hod2": "HOD2", "hod3": "HOD3",
        "basic": "BASIC", "gross": "GROSS", "shift": "SHIFT",
        "w_hour": "W_HOUR", "bldgrp": "BLDGRP", "location": "LOCATION",
        "track_location": "TRACK_LOCATION", "track_location_hr": "TRACK_LOCATION_HR",
        "emp_status": "EMP_STATUS", "ntn": "NTN", "bnkcode": "BNKCODE",
        "brncode": "BRNCODE", "bnkacct": "BNKACCT", "qfication": "QFICATION",
    }
    date_fields = {"dtofbrth": "DTOFBRTH", "dtofappt": "DTOFAPPT", "dtofconfirm": "DTOFCONFIRM"}

    # Fields that hold numeric Oracle values but are passed as strings from the frontend
    numeric_str_fields = {"dept_no", "desg_cd", "location"}

    set_parts = []
    params = {"empcode": empcode}

    for key, col in field_map.items():
        if key not in data or data[key] is None:
            continue
        val = data[key]
        if key == "religion":
            val = (_str_or_none(str(val)) or "")[:4] or None
            if val is None:
                continue
        elif key in numeric_str_fields:
            val = _num_or_none(val)
            if val is None:
                continue  # skip — don't update numeric field with empty string
        set_parts.append(f"{col} = :{key}")
        params[key] = val

    for key, col in date_fields.items():
        if key in data and data[key] is not None:
            date_val = _str_or_none(data[key])
            if date_val is None:
                continue  # skip empty date strings
            set_parts.append(f"{col} = TO_DATE(:{key}, 'YYYY-MM-DD')")
            params[key] = date_val

    # Qualification detail is stored in a child table; allow saving even if no
    # master column changed.
    has_qual = ("qfication" in data and data["qfication"] is not None) or \
               ("qual_detail" in data and data["qual_detail"] is not None)
    if not set_parts and not has_qual:
        return {"status": "error", "message": "No fields to update"}

    try:
        if set_parts:
            sql = f"UPDATE HR_EMP_MASTER SET {', '.join(set_parts)} WHERE EMPCODE = :empcode"
            cursor.execute(sql, params)
            conn.commit()
            if cursor.rowcount == 0:
                return {"status": "error", "message": "Employee not found"}
        _save_qualification_detail(cursor, conn, empcode, data)
        return {"status": "success", "message": "Employee updated successfully"}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# SEARCH EMPLOYEES
# ------------------------------------------------------------------

def search_employees_hrms(query: str, allowed_companies=None, allowed_branches=None) -> list:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        search = f"%{query.upper()}%"
        params = {"q": search}

        filter_parts = []
        if allowed_companies:
            nums = [n for n in (_to_int(c) for c in allowed_companies) if n is not None]
            if nums:
                ph = ", ".join(f":cmpf{i}" for i in range(len(nums)))
                filter_parts.append(f"TO_NUMBER(h.UNIT_ID) IN ({ph})")
                for i, n in enumerate(nums):
                    params[f"cmpf{i}"] = n
        if allowed_branches:
            nums = [n for n in (_to_int(b) for b in allowed_branches) if n is not None]
            if nums:
                ph = ", ".join(f":brnf{i}" for i in range(len(nums)))
                filter_parts.append(f"TO_NUMBER(h.LOCATION) IN ({ph})")
                for i, n in enumerate(nums):
                    params[f"brnf{i}"] = n

        filter_sql = (" AND " + " AND ".join(filter_parts)) if filter_parts else ""

        cursor.execute("""
            SELECT
                h.EMPCODE, h.NAME, h.FHNAME, h."ATDTCARD#",
                h.DEPT_NO, h.DESG_CD, h."MOBILE#", h.EMAIL,
                h.STATUS, h.HR_ADMIN, h.UNIT_ID,
                TO_CHAR(e.CARD_NO) AS CARD_NO,
                h.SEX, h.LOCATION,
                h.TRACK_LOCATION, h.TRACK_LOCATION_HR
            FROM HR_EMP_MASTER h
            LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
            WHERE (UPPER(h.NAME) LIKE :q
               OR h.EMPCODE LIKE :q
               OR h."ATDTCARD#" LIKE :q
               OR h."MOBILE#" LIKE :q)""" + filter_sql + """
            ORDER BY h.NAME
            FETCH FIRST 50 ROWS ONLY
        """, params)
        rows = cursor.fetchall()
        columns = [col[0].lower() for col in cursor.description]
        results = []
        for r in rows:
            d = dict(zip(columns, r))
            d["atdtcard"] = d.pop("atdtcard#", None)
            d["mobile"] = d.pop("mobile#", None)
            results.append(d)
        return results
    finally:
        cursor.close()
        conn.close()


def list_employees_hrms(status: str = None, allowed_companies=None, allowed_branches=None) -> list:
    """Return all employees, optionally filtered by status (A/I/L) and company/branch."""
    conn = get_connection()
    cursor = conn.cursor()
    _BASE_SELECT = """
                SELECT
                    h.EMPCODE, h.NAME, h.FHNAME, h."ATDTCARD#",
                    h.DEPT_NO, h.DESG_CD, h."MOBILE#", h.EMAIL,
                    h.STATUS, h.HR_ADMIN, h.UNIT_ID,
                    TO_CHAR(e.CARD_NO) AS CARD_NO,
                    h.SEX, h.LOCATION,
                    h.TRACK_LOCATION, h.TRACK_LOCATION_HR
                FROM HR_EMP_MASTER h
                LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
            """
    try:
        params = {}
        filter_parts = []
        if allowed_companies:
            nums = [n for n in (_to_int(c) for c in allowed_companies) if n is not None]
            if nums:
                ph = ", ".join(f":cmpf{i}" for i in range(len(nums)))
                filter_parts.append(f"TO_NUMBER(h.UNIT_ID) IN ({ph})")
                for i, n in enumerate(nums):
                    params[f"cmpf{i}"] = n
        if allowed_branches:
            nums = [n for n in (_to_int(b) for b in allowed_branches) if n is not None]
            if nums:
                ph = ", ".join(f":brnf{i}" for i in range(len(nums)))
                filter_parts.append(f"TO_NUMBER(h.LOCATION) IN ({ph})")
                for i, n in enumerate(nums):
                    params[f"brnf{i}"] = n

        filter_sql = (" AND " + " AND ".join(filter_parts)) if filter_parts else ""

        if status == "I":
            cursor.execute(_BASE_SELECT + f"""
                WHERE h.STATUS IN ('I', 'D'){filter_sql}
                ORDER BY h.NAME FETCH FIRST 2000 ROWS ONLY
            """, params)
        elif status in ("A", "L"):
            cursor.execute(_BASE_SELECT + f"""
                WHERE h.STATUS = :status{filter_sql}
                ORDER BY h.NAME FETCH FIRST 2000 ROWS ONLY
            """, {"status": status, **params})
        else:
            if filter_parts:
                cursor.execute(_BASE_SELECT + f"""
                    WHERE {" AND ".join(filter_parts)}
                    ORDER BY h.NAME FETCH FIRST 2000 ROWS ONLY
                """, params)
            else:
                cursor.execute(_BASE_SELECT + """
                    ORDER BY h.NAME FETCH FIRST 2000 ROWS ONLY
                """)
        rows = cursor.fetchall()
        columns = [col[0].lower() for col in cursor.description]
        results = []
        for r in rows:
            d = dict(zip(columns, r))
            d["atdtcard"] = d.pop("atdtcard#", None)
            d["mobile"] = d.pop("mobile#", None)
            results.append(d)
        return results
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# HR DASHBOARD — today's attendance overview across all employees
# ------------------------------------------------------------------

def _coerce_num(val):
    try:
        return int(val)
    except (ValueError, TypeError):
        return val


def _emp_filter_attempts(compc=None, brnch=None, alias="h"):
    """Return a list of (sql_fragment, params) tuples to try in order of decreasing
    restrictiveness. Each fragment is ' AND <conditions>' or '' for unfiltered.

    compc / brnch may each be a scalar, a list of values, or None. List values are
    rendered as IN (...) clauses so multi-company/branch admins are handled.
    """
    def _norm(v):
        if v is None or v == "":
            return []
        vals = v if isinstance(v, (list, tuple)) else [v]
        out = []
        for x in vals:
            n = _to_int(x)
            if n is not None:
                out.append(n)
        return out

    comp_nums = _norm(compc)
    brn_nums = _norm(brnch)

    def _comp_frag():
        ph = ", ".join(f":ecompc{i}" for i in range(len(comp_nums)))
        params = {f"ecompc{i}": n for i, n in enumerate(comp_nums)}
        return f"TO_NUMBER({alias}.UNIT_ID) IN ({ph})", params

    def _brn_frag():
        ph = ", ".join(f":ebrnch{i}" for i in range(len(brn_nums)))
        params = {f"ebrnch{i}": n for i, n in enumerate(brn_nums)}
        return f"TO_NUMBER({alias}.LOCATION) IN ({ph})", params

    attempts = []
    if comp_nums and brn_nums:
        cf, cp = _comp_frag()
        bf, bp = _brn_frag()
        attempts.append((f" AND {cf} AND {bf}", {**cp, **bp}))
    if comp_nums:
        cf, cp = _comp_frag()
        attempts.append((f" AND {cf}", cp))
    if brn_nums:
        bf, bp = _brn_frag()
        attempts.append((f" AND {bf}", bp))
    attempts.append(("", {}))
    return attempts


def _execute_with_emp_filter(cursor, sql_template, compc, brnch, alias="h", extra_params=None):
    """Execute sql_template (contains '{filter}' marker) trying COMPC+BRNCH, then
    COMPC alone, then BRNCH alone, then unfiltered. Raises if no attempt succeeds."""
    extra_params = extra_params or {}
    last_err = None
    for frag, params in _emp_filter_attempts(compc, brnch, alias):
        try:
            cursor.execute(sql_template.replace("{filter}", frag), {**extra_params, **params})
            return
        except Exception as e:
            if "ORA-00904" in str(e):
                last_err = str(e).splitlines()[0][:100]
                continue
            raise
    raise RuntimeError(f"All HR_EMP_MASTER filter attempts failed: {last_err}")


def _roster_card_filter(compc, brnch, params_out, prefix="rc"):
    """Build a SQL fragment ' AND TO_CHAR(CARD_NO) IN (subquery)' that restricts
    DUTY_ROSTER / ATTENDANCE_RECORDS rows to employees belonging to the given
    company/branch lists.  Populates *params_out* with the bind variables.
    compc / brnch may be a list or a single value or None.
    Returns empty string when no filter should be applied.
    """
    def _to_list(v):
        if not v:
            return []
        return v if isinstance(v, list) else [v]

    comp_list = _to_list(compc)
    brnch_list = _to_list(brnch)

    conds = []
    if comp_list:
        nums = [n for n in (_to_int(c) for c in comp_list) if n is not None]
        if nums:
            ph = ", ".join(f":{prefix}c{i}" for i in range(len(nums)))
            conds.append(f"TO_NUMBER(h.UNIT_ID) IN ({ph})")
            for i, n in enumerate(nums):
                params_out[f"{prefix}c{i}"] = n
    if brnch_list:
        nums = [n for n in (_to_int(b) for b in brnch_list) if n is not None]
        if nums:
            ph = ", ".join(f":{prefix}b{i}" for i in range(len(nums)))
            conds.append(f"TO_NUMBER(h.LOCATION) IN ({ph})")
            for i, n in enumerate(nums):
                params_out[f"{prefix}b{i}"] = n

    if not conds:
        return ""

    where_inner = " AND ".join(conds)
    # DUTY_ROSTER.CARD_NO matches EMPLOYEE.CARD_NO (e.g. "100011.2").
    # ATTENDANCE_RECORDS.CARD_NO matches the integer part (e.g. 100011).
    # Also include HR_EMP_MASTER.ATDTCARD# as a fallback for employees missing
    # from the EMPLOYEE view. The IN-list covers all three representations so the
    # same filter works for both DUTY_ROSTER and ATTENDANCE_RECORDS queries.
    return (
        f' AND TO_CHAR(CARD_NO) IN ('
        f'SELECT TO_CHAR(e.CARD_NO) FROM HR_EMP_MASTER h '
        f'JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE WHERE {where_inner} '
        f'UNION '
        f"SELECT REGEXP_SUBSTR(TO_CHAR(e.CARD_NO), '^[0-9]+') FROM HR_EMP_MASTER h "
        f'JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE WHERE {where_inner} '
        f'UNION '
        f'SELECT TO_CHAR(h."ATDTCARD#") FROM HR_EMP_MASTER h '
        f'WHERE h."ATDTCARD#" IS NOT NULL AND {where_inner})'
    )


def get_hr_dashboard_stats(qdate: str = None, compc=None, brnch=None) -> dict:
    """Get aggregated stats for the HR dashboard overview. qdate format: YYYY-MM-DD."""
    import re
    if qdate and re.match(r'^\d{4}-\d{2}-\d{2}$', qdate):
        td = f"TRUNC(DATE '{qdate}')"
        yd = f"TRUNC(DATE '{qdate}') - 1"
    else:
        td = "TRUNC(SYSDATE)"
        yd = "TRUNC(SYSDATE) - 1"

    conn = get_connection()
    cursor = conn.cursor()
    try:
        # Total active employees (filtered progressively by selected company/branch)
        total_employees = 0
        try:
            _execute_with_emp_filter(
                cursor,
                "SELECT COUNT(*) FROM HR_EMP_MASTER h WHERE (h.STATUS = 'A' OR h.STATUS IS NULL){filter}",
                compc, brnch,
            )
            total_employees = cursor.fetchone()[0] or 0
        except Exception as e:
            print(f"[HR_DASHBOARD] Total count failed: {e}")

        # Today's attendance from DUTY_ROSTER
        present = 0
        absent = 0
        late = 0
        incomplete = 0
        on_leave = 0

        # Present count: union of DUTY_ROSTER + ATTENDANCE_RECORDS to catch all check-ins.
        # Restricted to the selected company/branch via a CARD_NO subquery filter.
        present_params = {}
        card_filter = _roster_card_filter(compc, brnch, present_params, prefix="pc")
        try:
            cursor.execute("""
                SELECT COUNT(DISTINCT card_no) FROM (
                    SELECT TO_CHAR(CARD_NO) AS card_no
                    FROM DUTY_ROSTER
                    WHERE TRUNC(ROSTER_DATE) = {td} AND IN_TIME IS NOT NULL{cf}
                    UNION
                    SELECT TO_CHAR(CARD_NO) AS card_no
                    FROM ATTENDANCE_RECORDS
                    WHERE TRUNC(ATTENDANCE_DATE) = {td} AND ENTRY_TIME IS NOT NULL{cf}
                )
            """.format(td=td, cf=card_filter), present_params)
            present = int(cursor.fetchone()[0] or 0)
        except Exception as e:
            print(f"[HR_DASHBOARD] Present count query failed: {e}")

        # Late, on_leave, incomplete from DUTY_ROSTER; fallback incomplete from ATTENDANCE_RECORDS
        stats_params = {}
        stats_filter = _roster_card_filter(compc, brnch, stats_params, prefix="sc")
        try:
            cursor.execute("""
                SELECT
                    SUM(CASE WHEN IN_TIME IS NOT NULL AND OUT_TIME IS NULL THEN 1 ELSE 0 END),
                    SUM(CASE WHEN NVL(LATE_HRS, 0) > 0 OR NVL(LATE_MNT, 0) > 0 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN UPPER(STATUS) LIKE '%LEAVE%' THEN 1 ELSE 0 END)
                FROM DUTY_ROSTER
                WHERE TRUNC(ROSTER_DATE) = {td}{cf}
            """.format(td=td, cf=stats_filter), stats_params)
            row = cursor.fetchone()
            if row:
                incomplete = int(row[0] or 0)
                late = int(row[1] or 0)
                on_leave = int(row[2] or 0)
        except Exception as e:
            print(f"[HR_DASHBOARD] DUTY_ROSTER stats failed: {e}")
            try:
                inc_params = {}
                inc_filter = _roster_card_filter(compc, brnch, inc_params, prefix="ic")
                cursor.execute("""
                    SELECT SUM(CASE WHEN ENTRY_TIME IS NOT NULL AND EXIT_TIME IS NULL THEN 1 ELSE 0 END)
                    FROM ATTENDANCE_RECORDS
                    WHERE TRUNC(ATTENDANCE_DATE) = {td}{cf}
                """.format(td=td, cf=inc_filter), inc_params)
                r = cursor.fetchone()
                if r:
                    incomplete = int(r[0] or 0)
            except Exception:
                pass

        absent = max(total_employees - present - on_leave, 0)

        # Department-wise breakdown (filtered progressively)
        dept_breakdown = []
        try:
            _execute_with_emp_filter(cursor, f"""
                SELECT
                    NVL(dep.DEPT_NAME, NVL(TO_CHAR(h.DEPT_NO), 'Unknown')) AS dept,
                    COUNT(*) AS total,
                    SUM(CASE WHEN d.IN_TIME IS NOT NULL OR ar.card_no IS NOT NULL THEN 1 ELSE 0 END) AS present
                FROM HR_EMP_MASTER h
                LEFT JOIN (SELECT DEPT_NO, MIN(DEPT_NAME) AS DEPT_NAME FROM HR_DEPT GROUP BY DEPT_NO) dep
                    ON dep.DEPT_NO = h.DEPT_NO
                LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
                LEFT JOIN DUTY_ROSTER d
                    ON TO_CHAR(d.CARD_NO) = TO_CHAR(e.CARD_NO)
                    AND TRUNC(d.ROSTER_DATE) = {td}
                LEFT JOIN (
                    SELECT DISTINCT TO_CHAR(CARD_NO) AS card_no
                    FROM ATTENDANCE_RECORDS
                    WHERE TRUNC(ATTENDANCE_DATE) = {td} AND ENTRY_TIME IS NOT NULL
                ) ar ON ar.card_no = REGEXP_SUBSTR(TO_CHAR(e.CARD_NO), '^[0-9]+')
                WHERE (h.STATUS = 'A' OR h.STATUS IS NULL){{filter}}
                GROUP BY NVL(dep.DEPT_NAME, NVL(TO_CHAR(h.DEPT_NO), 'Unknown'))
                ORDER BY COUNT(*) DESC
                FETCH FIRST 10 ROWS ONLY
            """, compc, brnch)
            rows = cursor.fetchall()
            for r in rows:
                dept_breakdown.append({
                    "department": r[0] or "Unknown",
                    "total": int(r[1] or 0),
                    "present": int(r[2] or 0),
                })
        except Exception as e:
            print(f"[HR_DASHBOARD] Department breakdown failed: {e}")

        # Recent hires (last 30 days) — filtered progressively
        recent_hires = 0
        try:
            _execute_with_emp_filter(
                cursor,
                "SELECT COUNT(*) FROM HR_EMP_MASTER h WHERE h.DTOFAPPT >= SYSDATE - 30{filter}",
                compc, brnch,
            )
            recent_hires = int(cursor.fetchone()[0] or 0)
        except Exception:
            pass

        # Yesterday's stats for delta indicators
        yesterday_present = 0
        yesterday_on_leave = 0
        yesterday_absent = 0
        try:
            yday_params = {}
            yday_filter = _roster_card_filter(compc, brnch, yday_params, prefix="yd")
            cursor.execute("""
                SELECT
                    SUM(CASE WHEN IN_TIME IS NOT NULL THEN 1 ELSE 0 END),
                    SUM(CASE WHEN UPPER(STATUS) LIKE '%LEAVE%' THEN 1 ELSE 0 END)
                FROM DUTY_ROSTER
                WHERE TRUNC(ROSTER_DATE) = {yd}{cf}
            """.format(yd=yd, cf=yday_filter), yday_params)
            yrow = cursor.fetchone()
            if yrow:
                yesterday_present = int(yrow[0] or 0)
                yesterday_on_leave = int(yrow[1] or 0)
                yesterday_absent = max(total_employees - yesterday_present - yesterday_on_leave, 0)
        except Exception as e:
            print(f"[HR_DASHBOARD] Yesterday stats failed: {e}")

        # Upcoming birthdays (next 14 days) — filtered progressively
        upcoming_birthdays = []
        try:
            _execute_with_emp_filter(cursor, """
                SELECT h.NAME,
                    TO_CHAR(h.DTOFBRTH, 'DD Mon') AS bday,
                    NVL(dep.DEPT_NAME, 'N/A') AS dept,
                    MOD(TO_NUMBER(TO_CHAR(h.DTOFBRTH, 'DDD'))
                        - TO_NUMBER(TO_CHAR(SYSDATE, 'DDD')) + 365, 365) AS days_until
                FROM HR_EMP_MASTER h
                LEFT JOIN HR_DEPT dep ON dep.DEPT_NO = h.DEPT_NO
                WHERE (h.STATUS = 'A' OR h.STATUS IS NULL)
                  AND h.DTOFBRTH IS NOT NULL
                  AND MOD(TO_NUMBER(TO_CHAR(h.DTOFBRTH, 'DDD'))
                      - TO_NUMBER(TO_CHAR(SYSDATE, 'DDD')) + 365, 365) <= 14{filter}
                ORDER BY days_until
                FETCH FIRST 8 ROWS ONLY
            """, compc, brnch)
            for r in cursor.fetchall():
                upcoming_birthdays.append({
                    "name": r[0] or "Unknown",
                    "date": r[1] or "",
                    "dept": r[2] or "N/A",
                    "days_until": int(r[3] or 0),
                })
        except Exception as e:
            print(f"[HR_DASHBOARD] Birthdays failed: {e}")

        # Upcoming work anniversaries (next 14 days) — filtered progressively
        upcoming_anniversaries = []
        try:
            _execute_with_emp_filter(cursor, """
                SELECT h.NAME,
                    TO_CHAR(h.DTOFAPPT, 'DD Mon') AS ann_date,
                    TO_NUMBER(TO_CHAR(SYSDATE, 'YYYY'))
                        - TO_NUMBER(TO_CHAR(h.DTOFAPPT, 'YYYY')) AS years,
                    NVL(dep.DEPT_NAME, 'N/A') AS dept,
                    MOD(TO_NUMBER(TO_CHAR(h.DTOFAPPT, 'DDD'))
                        - TO_NUMBER(TO_CHAR(SYSDATE, 'DDD')) + 365, 365) AS days_until
                FROM HR_EMP_MASTER h
                LEFT JOIN HR_DEPT dep ON dep.DEPT_NO = h.DEPT_NO
                WHERE (h.STATUS = 'A' OR h.STATUS IS NULL)
                  AND h.DTOFAPPT IS NOT NULL
                  AND MOD(TO_NUMBER(TO_CHAR(h.DTOFAPPT, 'DDD'))
                      - TO_NUMBER(TO_CHAR(SYSDATE, 'DDD')) + 365, 365) <= 14
                  AND TO_NUMBER(TO_CHAR(SYSDATE, 'YYYY'))
                      > TO_NUMBER(TO_CHAR(h.DTOFAPPT, 'YYYY')){filter}
                ORDER BY days_until
                FETCH FIRST 8 ROWS ONLY
            """, compc, brnch)
            for r in cursor.fetchall():
                upcoming_anniversaries.append({
                    "name": r[0] or "Unknown",
                    "date": r[1] or "",
                    "years": int(r[2] or 1),
                    "dept": r[3] or "N/A",
                    "days_until": int(r[4] or 0),
                })
        except Exception as e:
            print(f"[HR_DASHBOARD] Anniversaries failed: {e}")

        # Upcoming leave requests (next 30 days)
        upcoming_leaves = []
        try:
            cursor.execute("""
                SELECT h.NAME,
                    la.LEAVE_DATE_FROM, la.LEAVE_DATE_TO,
                    la.LEAVE_TYPE_FK,
                    NVL(la.APPROVAL_STATUS, 'PENDING') AS status,
                    la.LEAVE_DAYS,
                    NVL(dep.DEPT_NAME, 'N/A') AS dept
                FROM LEAVE_APPLICATION la
                LEFT JOIN EMPLOYEE e ON TO_CHAR(e.CARD_NO) = TO_CHAR(la.EMP_FK)
                LEFT JOIN HR_EMP_MASTER h ON h.EMPCODE = e.EMPCODE
                LEFT JOIN HR_DEPT dep ON dep.DEPT_NO = h.DEPT_NO
                WHERE la.LEAVE_DATE_FROM >= TRUNC(SYSDATE)
                  AND la.LEAVE_DATE_FROM <= TRUNC(SYSDATE) + 30
                ORDER BY la.LEAVE_DATE_FROM
                FETCH FIRST 10 ROWS ONLY
            """)
            for r in cursor.fetchall():
                from_d = r[1]
                to_d = r[2]
                upcoming_leaves.append({
                    "name": r[0] or "Unknown",
                    "from_date": from_d.strftime('%Y-%m-%d') if from_d and hasattr(from_d, 'strftime') else str(from_d or ""),
                    "to_date": to_d.strftime('%Y-%m-%d') if to_d and hasattr(to_d, 'strftime') else str(to_d or ""),
                    "leave_type": int(r[3] or 0),
                    "status": r[4] or "PENDING",
                    "days": int(r[5] or 1),
                    "dept": r[6] or "N/A",
                })
        except Exception as e:
            print(f"[HR_DASHBOARD] Upcoming leaves failed: {e}")

        # Shift-wise attendance
        shift_wise = []
        try:
            shift_params = {}
            shift_filter = _roster_card_filter(compc, brnch, shift_params, prefix="sh")
            cursor.execute("""
                SELECT NVL(SHIFT, 'Day') AS shift_name,
                    SUM(CASE WHEN IN_TIME IS NOT NULL THEN 1 ELSE 0 END) AS present,
                    COUNT(*) AS total
                FROM DUTY_ROSTER
                WHERE TRUNC(ROSTER_DATE) = {td}{cf}
                GROUP BY NVL(SHIFT, 'Day')
                ORDER BY total DESC
            """.format(td=td, cf=shift_filter), shift_params)
            for r in cursor.fetchall():
                total_s = int(r[2] or 1)
                present_s = int(r[1] or 0)
                shift_wise.append({
                    "shift": r[0] or "Day",
                    "present": present_s,
                    "total": total_s,
                    "pct": round((present_s / total_s * 100) if total_s > 0 else 0, 1),
                })
        except Exception as e:
            print(f"[HR_DASHBOARD] Shift-wise failed: {e}")

        # Top absence/leave reasons this year
        top_reasons = []
        try:
            cursor.execute("""
                SELECT NVL(lt.LEAVE_DESC, 'Type ' || TO_CHAR(la.LEAVE_TYPE_FK)) AS reason,
                    COUNT(*) AS cnt
                FROM LEAVE_APPLICATION la
                LEFT JOIN LEAVE_TYPE lt ON lt.LEAVE_TYPE = la.LEAVE_TYPE_FK
                WHERE la.LEAVE_DATE_FROM >= TRUNC(SYSDATE, 'YYYY')
                GROUP BY NVL(lt.LEAVE_DESC, 'Type ' || TO_CHAR(la.LEAVE_TYPE_FK))
                ORDER BY cnt DESC
                FETCH FIRST 5 ROWS ONLY
            """)
            for r in cursor.fetchall():
                top_reasons.append({
                    "reason": r[0] or "Other",
                    "count": int(r[1] or 0),
                })
        except Exception as e:
            print(f"[HR_DASHBOARD] Top reasons failed: {e}")

        # Inactive count for turnover computation
        inactive_count = 0
        try:
            cursor.execute("""
                SELECT COUNT(*) FROM HR_EMP_MASTER WHERE STATUS IN ('I', 'D')
            """)
            inactive_count = int(cursor.fetchone()[0] or 0)
        except Exception:
            pass

        total_ever = total_employees + inactive_count
        turnover_ytd = round((inactive_count / total_ever * 100) if total_ever > 0 else 0, 1)

        return {
            "total_employees": total_employees,
            "present_today": present,
            "absent_today": absent,
            "late_today": late,
            "incomplete_today": incomplete,
            "on_leave_today": on_leave,
            "recent_hires": recent_hires,
            "department_breakdown": dept_breakdown,
            "yesterday_present": yesterday_present,
            "yesterday_absent": yesterday_absent,
            "yesterday_on_leave": yesterday_on_leave,
            "upcoming_birthdays": upcoming_birthdays,
            "upcoming_anniversaries": upcoming_anniversaries,
            "upcoming_leaves": upcoming_leaves,
            "shift_wise": shift_wise,
            "top_reasons": top_reasons,
            "turnover_ytd": turnover_ytd,
        }

    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# HR ANALYTICS — chart data for the enhanced dashboard
# ------------------------------------------------------------------

def get_hr_analytics(qdate: str = None, compc=None, brnch=None) -> dict:
    """Return chart-ready analytics: daily status (30d), monthly trends (6m), KPIs."""
    import re
    if qdate and re.match(r'^\d{4}-\d{2}-\d{2}$', qdate):
        td = f"TRUNC(DATE '{qdate}')"
    else:
        td = "TRUNC(SYSDATE)"

    conn = get_connection()
    cursor = conn.cursor()
    try:
        # Card-level filter (restricts DUTY_ROSTER / ATTENDANCE_RECORDS rows to the
        # selected company/branch). card_params holds ONLY the card-filter binds and
        # is passed to every DUTY_ROSTER / ATTENDANCE_RECORDS query.
        card_params: dict = {}
        cf = _roster_card_filter(compc, brnch, card_params, prefix="ac")

        # Direct HR_EMP_MASTER company/branch filter for the active-employee count.
        # emp_params holds ONLY the UNIT_ID/LOCATION binds — kept separate from
        # card_params so oracledb never receives bind keys absent from a query (DPY-4008).
        emp_frag, emp_params = _emp_filter_attempts(compc, brnch, alias="")[0]
        # alias="" yields "TO_NUMBER(.UNIT_ID)"; strip the stray leading dot.
        emp_filter = emp_frag.replace("TO_NUMBER(.", "TO_NUMBER(")

        late_logins = 0
        early_logins = 0
        overtime_hours = 0.0
        avg_work_hrs = 0.0
        unapproved_leaves = 0
        attendance_pct = 0.0

        try:
            cursor.execute("""
                SELECT
                    SUM(CASE WHEN NVL(LATE_HRS,0) > 0 OR NVL(LATE_MNT,0) > 0 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN IN_TIME IS NOT NULL AND NVL(LATE_HRS,0) = 0 AND NVL(LATE_MNT,0) = 0 THEN 1 ELSE 0 END),
                    NVL(SUM(NVL(OT_HRS,0) + NVL(OT_MNT,0)/60.0), 0),
                    NVL(AVG(CASE WHEN IN_TIME IS NOT NULL AND OUT_TIME IS NOT NULL
                        THEN NVL(W_HRS,0) + NVL(W_MNT,0)/60.0 END), 0)
                FROM DUTY_ROSTER
                WHERE TRUNC(ROSTER_DATE) = {td}{cf}
            """.format(td=td, cf=cf), card_params)
            row = cursor.fetchone()
            if row:
                late_logins = int(row[0] or 0)
                early_logins = int(row[1] or 0)
                overtime_hours = round(float(row[2] or 0), 1)
                avg_work_hrs = round(float(row[3] or 0), 1)
        except Exception as e:
            print(f"[HR_ANALYTICS] KPI query failed: {e}")

        try:
            cursor.execute("""
                SELECT COUNT(*) FROM LEAVE_APPLICATION
                WHERE STATUS IS NULL OR UPPER(STATUS) IN ('PENDING', 'P', '0')
            """)
            unapproved_leaves = int(cursor.fetchone()[0] or 0)
        except Exception:
            pass

        try:
            cursor.execute(
                f"SELECT COUNT(*) FROM HR_EMP_MASTER WHERE (STATUS = 'A' OR STATUS IS NULL){emp_filter}",
                emp_params,
            )
            total_active = int(cursor.fetchone()[0] or 0)
            cursor.execute("""
                SELECT COUNT(DISTINCT card_no) FROM (
                    SELECT TO_CHAR(CARD_NO) AS card_no FROM DUTY_ROSTER
                    WHERE TRUNC(ROSTER_DATE) = {td} AND IN_TIME IS NOT NULL{cf}
                    UNION
                    SELECT TO_CHAR(CARD_NO) AS card_no FROM ATTENDANCE_RECORDS
                    WHERE TRUNC(ATTENDANCE_DATE) = {td} AND ENTRY_TIME IS NOT NULL{cf}
                )
            """.format(td=td, cf=cf), card_params)
            present = int(cursor.fetchone()[0] or 0)
            attendance_pct = round((present / total_active * 100) if total_active > 0 else 0, 1)
        except Exception:
            pass

        # ── Daily attendance status — last 30 days ───────────────
        daily = []
        try:
            cursor.execute("""
                SELECT
                    TO_CHAR(d, 'DD Mon') AS day_label,
                    COUNT(DISTINCT CASE WHEN status_flag = 1 THEN card_no END) AS on_time,
                    COUNT(DISTINCT CASE WHEN status_flag = 2 THEN card_no END) AS late,
                    COUNT(DISTINCT CASE WHEN status_flag = 3 THEN card_no END) AS absent
                FROM (
                    SELECT TRUNC(ROSTER_DATE) AS d, TO_CHAR(CARD_NO) AS card_no,
                        CASE
                            WHEN IN_TIME IS NOT NULL AND NVL(LATE_HRS,0)=0 AND NVL(LATE_MNT,0)=0 THEN 1
                            WHEN IN_TIME IS NOT NULL AND (NVL(LATE_HRS,0)>0 OR NVL(LATE_MNT,0)>0) THEN 2
                            WHEN IN_TIME IS NULL AND UPPER(NVL(STATUS,'')) NOT LIKE '%LEAVE%' THEN 3
                            ELSE NULL
                        END AS status_flag
                    FROM DUTY_ROSTER
                    WHERE TRUNC(ROSTER_DATE) BETWEEN {td} - 29 AND {td}{cf}
                    UNION ALL
                    SELECT TRUNC(ar.ATTENDANCE_DATE) AS d, TO_CHAR(ar.CARD_NO) AS card_no, 1 AS status_flag
                    FROM ATTENDANCE_RECORDS ar
                    WHERE TRUNC(ar.ATTENDANCE_DATE) BETWEEN {td} - 29 AND {td}
                      AND ar.ENTRY_TIME IS NOT NULL{cf}
                      AND NOT EXISTS (
                        SELECT 1 FROM DUTY_ROSTER dr
                        WHERE TO_CHAR(dr.CARD_NO) = TO_CHAR(ar.CARD_NO)
                          AND TRUNC(dr.ROSTER_DATE) = TRUNC(ar.ATTENDANCE_DATE)
                      )
                )
                WHERE status_flag IS NOT NULL
                GROUP BY TO_CHAR(d, 'DD Mon'), d
                ORDER BY d
            """.format(td=td, cf=cf), card_params)
            for r in cursor.fetchall():
                daily.append({
                    "day": r[0],
                    "on_time": int(r[1] or 0),
                    "late": int(r[2] or 0),
                    "absent": int(r[3] or 0),
                })
        except Exception as e:
            print(f"[HR_ANALYTICS] Daily query failed: {e}")

        # ── Monthly attendance statistics — last 6 months ────────
        monthly = []
        try:
            cursor.execute("""
                SELECT
                    TO_CHAR(TRUNC(d, 'MM'), 'Mon YY') AS month_label,
                    SUM(on_time_cnt) AS on_time,
                    SUM(overtime_cnt) AS overtime,
                    SUM(on_leave_cnt) AS on_leave,
                    SUM(late_cnt) AS late_clockin,
                    SUM(absent_cnt) AS absent,
                    SUM(total_cnt) AS total_rows,
                    TRUNC(d, 'MM') AS month_key
                FROM (
                    SELECT TRUNC(ROSTER_DATE) AS d,
                        CASE WHEN IN_TIME IS NOT NULL AND NVL(LATE_HRS,0)=0 AND NVL(LATE_MNT,0)=0 THEN 1 ELSE 0 END AS on_time_cnt,
                        CASE WHEN NVL(OT_HRS,0)>0 OR NVL(OT_MNT,0)>0 THEN 1 ELSE 0 END AS overtime_cnt,
                        CASE WHEN UPPER(NVL(STATUS,'')) LIKE '%LEAVE%' THEN 1 ELSE 0 END AS on_leave_cnt,
                        CASE WHEN IN_TIME IS NOT NULL AND (NVL(LATE_HRS,0)>0 OR NVL(LATE_MNT,0)>0) THEN 1 ELSE 0 END AS late_cnt,
                        CASE WHEN IN_TIME IS NULL AND UPPER(NVL(STATUS,'')) NOT LIKE '%LEAVE%' THEN 1 ELSE 0 END AS absent_cnt,
                        1 AS total_cnt
                    FROM DUTY_ROSTER
                    WHERE TRUNC(ROSTER_DATE) BETWEEN ADD_MONTHS(TRUNC({td}, 'MM'), -5) AND {td}{cf}
                    UNION ALL
                    SELECT TRUNC(ar.ATTENDANCE_DATE) AS d, 1, 0, 0, 0, 0, 1
                    FROM ATTENDANCE_RECORDS ar
                    WHERE TRUNC(ar.ATTENDANCE_DATE) BETWEEN ADD_MONTHS(TRUNC({td}, 'MM'), -5) AND {td}
                      AND ar.ENTRY_TIME IS NOT NULL{cf}
                      AND NOT EXISTS (
                        SELECT 1 FROM DUTY_ROSTER dr
                        WHERE TO_CHAR(dr.CARD_NO) = TO_CHAR(ar.CARD_NO)
                          AND TRUNC(dr.ROSTER_DATE) = TRUNC(ar.ATTENDANCE_DATE)
                      )
                )
                GROUP BY TO_CHAR(TRUNC(d, 'MM'), 'Mon YY'), TRUNC(d, 'MM')
                ORDER BY TRUNC(d, 'MM')
            """.format(td=td, cf=cf), card_params)
            for r in cursor.fetchall():
                total = int(r[6] or 1)
                present_cnt = int(r[1] or 0) + int(r[4] or 0) + int(r[3] or 0)
                absent_cnt = int(r[5] or 0)
                monthly.append({
                    "month": r[0],
                    "available": int(r[1] or 0),
                    "overtime": int(r[2] or 0),
                    "on_leave": int(r[3] or 0),
                    "late_clockin": int(r[4] or 0),
                    "absent": absent_cnt,
                    "attendance_pct": round((present_cnt / total * 100) if total > 0 else 0, 1),
                    "absenteeism_rate": round((absent_cnt / total * 100) if total > 0 else 2),
                })
        except Exception as e:
            print(f"[HR_ANALYTICS] Monthly query failed: {e}")

        return {
            "kpis": {
                "late_logins": late_logins,
                "early_logins": early_logins,
                "overtime_hours": overtime_hours,
                "unapproved_leaves": unapproved_leaves,
                "avg_work_hrs": avg_work_hrs,
                "attendance_pct": attendance_pct,
            },
            "daily_attendance": daily,
            "monthly_attendance": monthly,
        }

    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# BULK ATTENDANCE SUMMARY — per-employee aggregated stats for HR
# ------------------------------------------------------------------

def get_bulk_attendance_summary(
    from_date: str,
    to_date: str,
    allowed_companies=None,
    allowed_branches=None,
) -> list:
    """Return aggregated attendance stats for every active employee in the given
    date range, filtered by company/branch.  Tries DUTY_ROSTER + EMPLOYEE join
    first; falls back to ATTENDANCE_RECORDS if DUTY_ROSTER is absent; final
    fallback returns employee list with zero counts if both tables are missing."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        filter_parts: list = []
        params: dict = {"from_d": from_date, "to_d": to_date}

        if allowed_companies:
            nums = [n for n in (_to_int(c) for c in allowed_companies) if n is not None]
            if nums:
                ph = ", ".join(f":cmpf{i}" for i in range(len(nums)))
                filter_parts.append(f"TO_NUMBER(h.UNIT_ID) IN ({ph})")
                for i, n in enumerate(nums):
                    params[f"cmpf{i}"] = n
        if allowed_branches:
            nums = [n for n in (_to_int(b) for b in allowed_branches) if n is not None]
            if nums:
                ph = ", ".join(f":brnf{i}" for i in range(len(nums)))
                filter_parts.append(f"TO_NUMBER(h.LOCATION) IN ({ph})")
                for i, n in enumerate(nums):
                    params[f"brnf{i}"] = n

        filter_sql = (" AND " + " AND ".join(filter_parts)) if filter_parts else ""

        # Attempt 1: DUTY_ROSTER + EMPLOYEE join (only pulls CARD_NO from EMPLOYEE)
        try:
            cursor.execute(f"""
                SELECT
                    h.EMPCODE,
                    h.NAME,
                    h."ATDTCARD#"                                     AS atdtcard,
                    TO_CHAR(e.CARD_NO)                                AS card_no,
                    NVL(dep.DEPT_NAME, TO_CHAR(h.DEPT_NO))           AS dept_name,
                    h.UNIT_ID,
                    h.LOCATION,
                    h.STATUS                                          AS emp_status,
                    COUNT(d.ROSTER_DATE)                              AS total_days,
                    SUM(CASE WHEN d.IN_TIME IS NOT NULL THEN 1 ELSE 0 END)            AS present_days,
                    SUM(CASE WHEN d.IN_TIME IS NULL
                              AND d.ROSTER_DATE IS NOT NULL THEN 1 ELSE 0 END)        AS absent_days,
                    SUM(NVL(d.LATE_HRS, 0) * 60 + NVL(d.LATE_MNT, 0))               AS late_minutes,
                    SUM(NVL(d.OT_HRS,   0) * 60 + NVL(d.OT_MNT,   0))               AS ot_minutes,
                    SUM(NVL(d.W_HRS,    0) * 60 + NVL(d.W_MNT,    0))               AS working_minutes
                FROM HR_EMP_MASTER h
                LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
                LEFT JOIN DUTY_ROSTER d
                    ON  TO_CHAR(d.CARD_NO) = TO_CHAR(e.CARD_NO)
                    AND TRUNC(d.ROSTER_DATE) BETWEEN
                        TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
                LEFT JOIN (SELECT DEPT_NO, MIN(DEPT_NAME) AS DEPT_NAME FROM HR_DEPT GROUP BY DEPT_NO) dep
                    ON dep.DEPT_NO = h.DEPT_NO
                WHERE h.STATUS = 'A'{filter_sql}
                GROUP BY
                    h.EMPCODE, h.NAME, h."ATDTCARD#", TO_CHAR(e.CARD_NO),
                    dep.DEPT_NAME, h.DEPT_NO, h.UNIT_ID, h.LOCATION, h.STATUS
                ORDER BY h.NAME
                FETCH FIRST 1000 ROWS ONLY
            """, params)
            rows = cursor.fetchall()
            columns = [c[0].lower() for c in cursor.description]
            result = [dict(zip(columns, r)) for r in rows]
            for rec in result:
                if rec.get("card_no") is None:
                    rec["card_no"] = rec.get("atdtcard")
            return result
        except Exception as e:
            err = str(e)
            print(f"[BULK_ATT] DUTY_ROSTER+EMPLOYEE attempt failed: {err}")
            if "ORA-00942" not in err and "ORA-01427" not in err:
                raise

        # Attempt 2: ATTENDANCE_RECORDS + EMPLOYEE join
        try:
            cursor.execute(f"""
                SELECT
                    h.EMPCODE,
                    h.NAME,
                    h."ATDTCARD#"                                     AS atdtcard,
                    TO_CHAR(e.CARD_NO)                                AS card_no,
                    NVL(dep.DEPT_NAME, TO_CHAR(h.DEPT_NO))           AS dept_name,
                    h.UNIT_ID,
                    h.LOCATION,
                    h.STATUS                                          AS emp_status,
                    COUNT(ar.ATTENDANCE_DATE)                         AS total_days,
                    SUM(CASE WHEN ar.ENTRY_TIME IS NOT NULL THEN 1 ELSE 0 END)  AS present_days,
                    SUM(CASE WHEN ar.ENTRY_TIME IS NULL
                              AND ar.ATTENDANCE_DATE IS NOT NULL THEN 1 ELSE 0 END) AS absent_days,
                    0                                                 AS late_minutes,
                    0                                                 AS ot_minutes,
                    SUM(NVL(ar.TIME_SPENT, 0))                        AS working_minutes
                FROM HR_EMP_MASTER h
                LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
                LEFT JOIN ATTENDANCE_RECORDS ar
                    ON  ar.CARD_NO = TO_NUMBER(REGEXP_REPLACE(TO_CHAR(e.CARD_NO), '\\..*', ''))
                    AND TRUNC(ar.ATTENDANCE_DATE) BETWEEN
                        TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
                LEFT JOIN (SELECT DEPT_NO, MIN(DEPT_NAME) AS DEPT_NAME FROM HR_DEPT GROUP BY DEPT_NO) dep
                    ON dep.DEPT_NO = h.DEPT_NO
                WHERE h.STATUS = 'A'{filter_sql}
                GROUP BY
                    h.EMPCODE, h.NAME, h."ATDTCARD#", TO_CHAR(e.CARD_NO),
                    dep.DEPT_NAME, h.DEPT_NO, h.UNIT_ID, h.LOCATION, h.STATUS
                ORDER BY h.NAME
                FETCH FIRST 1000 ROWS ONLY
            """, params)
            rows = cursor.fetchall()
            columns = [c[0].lower() for c in cursor.description]
            result = [dict(zip(columns, r)) for r in rows]
            for rec in result:
                if rec.get("card_no") is None:
                    rec["card_no"] = rec.get("atdtcard")
            return result
        except Exception as e:
            err = str(e)
            print(f"[BULK_ATT] ATTENDANCE_RECORDS attempt failed: {err}")
            if "ORA-00942" not in err and "ORA-01427" not in err:
                raise

        # Attempt 3: employee list only, zero attendance counts
        cursor.execute(f"""
            SELECT
                h.EMPCODE,
                h.NAME,
                h."ATDTCARD#"                                 AS atdtcard,
                h."ATDTCARD#"                                 AS card_no,
                NVL(dep.DEPT_NAME, TO_CHAR(h.DEPT_NO))       AS dept_name,
                h.UNIT_ID,
                h.LOCATION,
                h.STATUS                                      AS emp_status,
                0 AS total_days,
                0 AS present_days,
                0 AS absent_days,
                0 AS late_minutes,
                0 AS ot_minutes,
                0 AS working_minutes
            FROM HR_EMP_MASTER h
            LEFT JOIN (SELECT DEPT_NO, MIN(DEPT_NAME) AS DEPT_NAME FROM HR_DEPT GROUP BY DEPT_NO) dep
                ON dep.DEPT_NO = h.DEPT_NO
            WHERE h.STATUS = 'A'{filter_sql}
            ORDER BY h.NAME
            FETCH FIRST 1000 ROWS ONLY
        """, params)
        rows = cursor.fetchall()
        columns = [c[0].lower() for c in cursor.description]
        return [dict(zip(columns, r)) for r in rows]

    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# BULK ATTENDANCE DETAILS — raw per-day rows (for Details tab / CSV)
# ------------------------------------------------------------------

def get_bulk_attendance_details(
    from_date: str,
    to_date: str,
    allowed_companies=None,
    allowed_branches=None,
) -> list:
    """Return one row per employee per present day in the date range.
    Columns: atdtcard, card_no, name, roster_date (YYYY-MM-DD),
             duty_in (H:MM), duty_out (H:MM), in_time (H:MM), out_time (H:MM).
    Mirrors the format of the attendance_sheet_for_upload.csv."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        filter_parts: list = []
        params: dict = {"from_d": from_date, "to_d": to_date}

        if allowed_companies:
            nums = [n for n in (_to_int(c) for c in allowed_companies) if n is not None]
            if nums:
                ph = ", ".join(f":cmpf{i}" for i in range(len(nums)))
                filter_parts.append(f"TO_NUMBER(h.UNIT_ID) IN ({ph})")
                for i, n in enumerate(nums):
                    params[f"cmpf{i}"] = n
        if allowed_branches:
            nums = [n for n in (_to_int(b) for b in allowed_branches) if n is not None]
            if nums:
                ph = ", ".join(f":brnf{i}" for i in range(len(nums)))
                filter_parts.append(f"TO_NUMBER(h.LOCATION) IN ({ph})")
                for i, n in enumerate(nums):
                    params[f"brnf{i}"] = n

        filter_sql = (" AND " + " AND ".join(filter_parts)) if filter_parts else ""

        def _fmt_time(v):
            if v is None:
                return None
            if hasattr(v, 'hour'):
                return f"{v.hour}:{v.minute:02d}"
            s = str(v).strip()
            if not s:
                return None
            parts = s.split(":")
            if len(parts) >= 2:
                try:
                    return f"{int(parts[0])}:{parts[1].zfill(2)[:2]}"
                except ValueError:
                    return s
            return s

        def _fmt_date(v):
            if v is None:
                return None
            if hasattr(v, 'strftime'):
                return v.strftime('%Y-%m-%d')
            s = str(v)
            return s[:10] if len(s) >= 10 else s

        def _process(rows, cols):
            result = []
            for row in rows:
                rec = dict(zip(cols, row))
                rec["roster_date"] = _fmt_date(rec.get("roster_date"))
                rec["in_time"]     = _fmt_time(rec.get("in_time"))
                rec["out_time"]    = _fmt_time(rec.get("out_time"))
                rec["duty_in"]     = _fmt_time(rec.get("duty_in"))
                rec["duty_out"]    = _fmt_time(rec.get("duty_out"))
                result.append(rec)
            return result

        # ── helper: run query; on handled Oracle errors OR 0 rows → return ([], None) ──
        def _run(sql, bind, label, require_rows=True):
            try:
                cursor.execute(sql, bind)
                r = cursor.fetchall()
                c = [x[0].lower() for x in cursor.description]
                if require_rows and not r:
                    print(f"[BULK_DET] {label}: 0 rows, trying next")
                    return [], None
                return r, c
            except Exception as exc:
                msg = str(exc)
                print(f"[BULK_DET] {label}: {msg}")
                if any(x in msg for x in ("ORA-00904", "ORA-00942", "ORA-01427", "DPY-4008")):
                    return [], None
                raise

        # ── Attempt 1: full columns (DUTY_IN/DUTY_OUT/SHIFT) + EMPLOYEE join ──────
        # Uses identical join as summary (TO_CHAR both sides). Falls through on
        # ORA-00904 (columns missing) or 0 rows.
        rows, cols = _run(f"""
            SELECT
                NVL(h."ATDTCARD#", TO_CHAR(e.CARD_NO))  AS atdtcard,
                TO_CHAR(e.CARD_NO)                       AS card_no,
                h.NAME                                   AS name,
                d.ROSTER_DATE                            AS roster_date,
                d.DUTY_IN                                AS duty_in,
                d.DUTY_OUT                               AS duty_out,
                d.IN_TIME                                AS in_time,
                d.OUT_TIME                               AS out_time
            FROM HR_EMP_MASTER h
            LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
            JOIN DUTY_ROSTER d
                ON  TO_CHAR(d.CARD_NO) = TO_CHAR(e.CARD_NO)
                AND TRUNC(d.ROSTER_DATE) BETWEEN
                    TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
            WHERE h.STATUS = 'A'{filter_sql}
            ORDER BY NVL(h."ATDTCARD#", TO_CHAR(d.CARD_NO)), d.ROSTER_DATE
            FETCH FIRST 10000 ROWS ONLY
        """, params, "Attempt 1 (DUTY_IN/OUT + SHIFT + EMPLOYEE)")
        if rows:
            return _process(rows, cols)

        # ── Attempt 2: no DUTY_IN/DUTY_OUT, still try SHIFT ─────────────────────
        rows, cols = _run(f"""
            SELECT
                NVL(h."ATDTCARD#", TO_CHAR(e.CARD_NO))  AS atdtcard,
                TO_CHAR(e.CARD_NO)                       AS card_no,
                h.NAME                                   AS name,
                d.ROSTER_DATE                            AS roster_date,
                NULL                                     AS duty_in,
                NULL                                     AS duty_out,
                d.IN_TIME                                AS in_time,
                d.OUT_TIME                               AS out_time
            FROM HR_EMP_MASTER h
            LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
            JOIN DUTY_ROSTER d
                ON  TO_CHAR(d.CARD_NO) = TO_CHAR(e.CARD_NO)
                AND TRUNC(d.ROSTER_DATE) BETWEEN
                    TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
            WHERE h.STATUS = 'A'{filter_sql}
            ORDER BY NVL(h."ATDTCARD#", TO_CHAR(d.CARD_NO)), d.ROSTER_DATE
            FETCH FIRST 10000 ROWS ONLY
        """, params, "Attempt 2 (SHIFT + EMPLOYEE)")
        if rows:
            return _process(rows, cols)

        # ── Attempt 3: safe DUTY_ROSTER columns, join via ATDTCARD# directly ──────
        # Skips EMPLOYEE view entirely — joins DUTY_ROSTER to HR_EMP_MASTER on
        # ATDTCARD# so names are populated even when EMPLOYEE view is missing rows.
        rows, cols = _run(f"""
            SELECT
                TO_CHAR(d.CARD_NO)                       AS atdtcard,
                TO_CHAR(d.CARD_NO)                       AS card_no,
                h.NAME                                   AS name,
                d.ROSTER_DATE                            AS roster_date,
                NULL                                     AS duty_in,
                NULL                                     AS duty_out,
                d.IN_TIME                                AS in_time,
                d.OUT_TIME                               AS out_time
            FROM DUTY_ROSTER d
            JOIN HR_EMP_MASTER h
                ON  TO_CHAR(d.CARD_NO) = TO_CHAR(h."ATDTCARD#")
            WHERE TRUNC(d.ROSTER_DATE) BETWEEN
                    TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
                AND h.STATUS = 'A'{filter_sql}
            ORDER BY TO_CHAR(d.CARD_NO), d.ROSTER_DATE
            FETCH FIRST 10000 ROWS ONLY
        """, params, "Attempt 3 (DUTY_ROSTER INNER JOIN HR_EMP_MASTER via ATDTCARD#)")
        if rows:
            return _process(rows, cols)

        # ── Attempt 4: INNER JOIN via ATDTCARD# — no EMPLOYEE view needed ────────
        # Converts filter to INNER JOIN ON clause so NULL h rows don't slip past.
        # Only carry date params — the f-suffix filter params must NOT be included
        # here because the SQL uses j-suffix placeholders, and oracledb raises
        # DPY-4008 if the bind dict contains keys that don't appear in the SQL text.
        join_parts = []
        join_params = {"from_d": from_date, "to_d": to_date}
        if allowed_companies:
            nums = [n for n in (_to_int(c) for c in allowed_companies) if n is not None]
            if nums:
                ph = ", ".join(f":cmpj{i}" for i in range(len(nums)))
                join_parts.append(f"TO_NUMBER(h.UNIT_ID) IN ({ph})")
                for i, n in enumerate(nums):
                    join_params[f"cmpj{i}"] = n
        if allowed_branches:
            nums = [n for n in (_to_int(b) for b in allowed_branches) if n is not None]
            if nums:
                ph = ", ".join(f":brnj{i}" for i in range(len(nums)))
                join_parts.append(f"TO_NUMBER(h.LOCATION) IN ({ph})")
                for i, n in enumerate(nums):
                    join_params[f"brnj{i}"] = n
        join_on_extra = (" AND " + " AND ".join(join_parts)) if join_parts else ""

        rows, cols = _run(f"""
            SELECT
                NVL(h."ATDTCARD#", TO_CHAR(d.CARD_NO))  AS atdtcard,
                NVL(h."ATDTCARD#", TO_CHAR(d.CARD_NO))  AS card_no,
                h.NAME                                   AS name,
                d.ROSTER_DATE                            AS roster_date,
                NULL                                     AS duty_in,
                NULL                                     AS duty_out,
                d.IN_TIME                                AS in_time,
                d.OUT_TIME                               AS out_time
            FROM DUTY_ROSTER d
            JOIN HR_EMP_MASTER h
                ON  TO_CHAR(d.CARD_NO) = TO_CHAR(h."ATDTCARD#"){join_on_extra}
            WHERE TRUNC(d.ROSTER_DATE) BETWEEN
                TO_DATE(:from_d, 'YYYY-MM-DD') AND TO_DATE(:to_d, 'YYYY-MM-DD')
            ORDER BY d.CARD_NO, d.ROSTER_DATE
            FETCH FIRST 10000 ROWS ONLY
        """, join_params, "Attempt 4 (ATDTCARD# INNER JOIN)")
        if rows:
            return _process(rows, cols)

        # ── Attempt 5: DUTY_ROSTER INNER JOIN HR_EMP_MASTER with hard filter ────────
        # Uses INNER JOIN so only employees that actually exist in HR_EMP_MASTER
        # are returned, and the company/branch filter on h.UNIT_ID / h.LOCATION
        # is unambiguously applied in a separate WHERE clause (not inside BETWEEN).
        # This prevents NULL-h rows from slipping through the LEFT JOIN path.
        date_filter = (
            "TRUNC(d.ROSTER_DATE) >= TO_DATE(:from_d, 'YYYY-MM-DD') "
            "AND TRUNC(d.ROSTER_DATE) <= TO_DATE(:to_d, 'YYYY-MM-DD')"
        )
        rows, cols = _run(f"""
            SELECT
                TO_CHAR(d.CARD_NO)  AS atdtcard,
                TO_CHAR(d.CARD_NO)  AS card_no,
                h.NAME              AS name,
                d.ROSTER_DATE       AS roster_date,
                NULL                AS duty_in,
                NULL                AS duty_out,
                d.IN_TIME           AS in_time,
                d.OUT_TIME          AS out_time
            FROM DUTY_ROSTER d
            INNER JOIN HR_EMP_MASTER h
                ON  TO_CHAR(d.CARD_NO) = TO_CHAR(h."ATDTCARD#")
            WHERE {date_filter}{filter_sql}
            ORDER BY d.CARD_NO, d.ROSTER_DATE
            FETCH FIRST 10000 ROWS ONLY
        """, params, "Attempt 5 (INNER JOIN + company filter)", require_rows=False)
        return _process(rows, cols)

    finally:
        cursor.close()
        conn.close()
