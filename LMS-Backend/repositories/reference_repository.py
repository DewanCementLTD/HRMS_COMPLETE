"""Reference data repository — read + add entries for lookup tables."""

from core.database import get_connection


def _coerce(val):
    try:
        return int(val)
    except (ValueError, TypeError):
        return val


def _try_progressive(cursor, sql_template: str, compc=None, brnch=None):
    """Run sql_template with {filter} placeholder, trying filters progressively:
       1) COMPC + BRNCH (if both supplied)
       2) COMPC only (if supplied)
       3) BRNCH only (if supplied)
       4) Unfiltered
    Each attempt that fails with ORA-00904 (column missing) advances to the next.
    Returns rows from the first successful attempt.
    """
    attempts = []
    if compc and brnch:
        attempts.append((
            "AND COMPC = :fcompc AND BRNCH = :fbrnch",
            {"fcompc": _coerce(compc), "fbrnch": _coerce(brnch)},
        ))
    if compc:
        attempts.append((
            "AND COMPC = :fcompc",
            {"fcompc": _coerce(compc)},
        ))
    if brnch:
        attempts.append((
            "AND BRNCH = :fbrnch",
            {"fbrnch": _coerce(brnch)},
        ))
    attempts.append(("", {}))

    last_err = None
    for filter_sql, params in attempts:
        try:
            cursor.execute(sql_template.replace("{filter}", filter_sql), params)
            return cursor.fetchall()
        except Exception as e:
            msg = str(e)
            if "ORA-00904" in msg:
                last_err = msg.splitlines()[0][:100]
                continue
            raise
    print(f"[REFERENCE] All filter attempts failed: {last_err}")
    return []


# ─────────────────────────────────────────────────────────────────
# READ FUNCTIONS
# ─────────────────────────────────────────────────────────────────

def get_departments(compc=None, brnch=None) -> list:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        rows = _try_progressive(
            cursor,
            "SELECT DEPT_NO, DEPT_NAME FROM HR_DEPT WHERE 1=1 {filter} ORDER BY DEPT_NAME",
            compc, brnch,
        )
        return [{"dept_no": r[0], "dept_name": (r[1] or "").strip()} for r in rows]
    finally:
        cursor.close(); conn.close()


def get_grades(compc=None, brnch=None) -> list:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        rows = _try_progressive(
            cursor,
            "SELECT GRADE_CD, DESCR FROM HR_GRADE_CD WHERE (STATUS = 'A' OR STATUS IS NULL) {filter} ORDER BY GRADE_CD",
            compc, brnch,
        )
        return [{"grade_cd": (r[0] or "").strip(), "descr": (r[1] or "").strip()} for r in rows]
    finally:
        cursor.close(); conn.close()


def get_emp_statuses(compc=None) -> list:
    """Employee-status lookup (HR_EMP_STATUS) — code + description, scoped to the
    company (UNIT_ID) plus any global (UNIT_ID IS NULL) rows."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        c = _coerce(compc) if compc else None
        if c is not None:
            try:
                cursor.execute(
                    "SELECT EMP_STATUS, EMP_STATUS_DESC FROM HR_EMP_STATUS "
                    "WHERE EMP_STATUS IS NOT NULL AND (UNIT_ID = :u OR UNIT_ID IS NULL) "
                    "ORDER BY EMP_STATUS", {"u": c})
                return [{"emp_status": (r[0] or "").strip(), "descr": (r[1] or "").strip()}
                        for r in cursor.fetchall()]
            except Exception:
                pass
        cursor.execute(
            "SELECT EMP_STATUS, EMP_STATUS_DESC FROM HR_EMP_STATUS "
            "WHERE EMP_STATUS IS NOT NULL ORDER BY EMP_STATUS")
        return [{"emp_status": (r[0] or "").strip(), "descr": (r[1] or "").strip()}
                for r in cursor.fetchall()]
    except Exception as e:
        print(f"[REFERENCE] emp_statuses failed: {e}")
        return []
    finally:
        cursor.close(); conn.close()


def get_banks(compc=None) -> list:
    """Bank lookup (HR_BANK). Banks are scoped by company (UNIT_ID) when set,
    plus any global (UNIT_ID IS NULL) rows; falls back to all on error."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        c = _coerce(compc) if compc else None
        if c is not None:
            try:
                cursor.execute(
                    "SELECT BNKCODE, BNKNAME FROM HR_BANK "
                    "WHERE (UNIT_ID = :u OR UNIT_ID IS NULL) AND BNKCODE IS NOT NULL "
                    "ORDER BY BNKNAME", {"u": c})
                return [{"bnkcode": (r[0] or "").strip(), "bnkname": (r[1] or "").strip()}
                        for r in cursor.fetchall()]
            except Exception:
                pass
        cursor.execute("SELECT BNKCODE, BNKNAME FROM HR_BANK WHERE BNKCODE IS NOT NULL ORDER BY BNKNAME")
        return [{"bnkcode": (r[0] or "").strip(), "bnkname": (r[1] or "").strip()}
                for r in cursor.fetchall()]
    except Exception as e:
        print(f"[REFERENCE] banks failed: {e}")
        return []
    finally:
        cursor.close(); conn.close()


def get_bank_branches(bnkcode: str = None) -> list:
    """Bank-branch lookup (HR_BRANCH), filtered to the selected bank (BNKCODE)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        if bnkcode:
            cursor.execute(
                "SELECT BRNCODE, BRNNAME FROM HR_BRANCH WHERE BNKCODE = :b "
                "AND BRNCODE IS NOT NULL ORDER BY BRNNAME", {"b": str(bnkcode).strip()})
        else:
            cursor.execute(
                "SELECT BRNCODE, BRNNAME FROM HR_BRANCH WHERE BRNCODE IS NOT NULL ORDER BY BRNNAME")
        return [{"brncode": (r[0] or "").strip(), "brnname": (r[1] or "").strip()}
                for r in cursor.fetchall()]
    except Exception as e:
        print(f"[REFERENCE] bank_branches failed: {e}")
        return []
    finally:
        cursor.close(); conn.close()


def get_qualifications(compc=None) -> list:
    """Qualification options — distinct descriptions from HR_EMP_QUALIFICATION,
    scoped to the company (UNIT_ID) plus any global (UNIT_ID IS NULL)."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        c = _coerce(compc) if compc else None
        if c is not None:
            try:
                cursor.execute(
                    "SELECT DISTINCT TRIM(DESCR) FROM HR_EMP_QUALIFICATION "
                    "WHERE DESCR IS NOT NULL AND TRIM(DESCR) IS NOT NULL "
                    "AND (UNIT_ID = :u OR UNIT_ID IS NULL) ORDER BY 1", {"u": c})
                return [{"descr": (r[0] or "").strip()} for r in cursor.fetchall() if (r[0] or "").strip()]
            except Exception:
                pass
        cursor.execute(
            "SELECT DISTINCT TRIM(DESCR) FROM HR_EMP_QUALIFICATION "
            "WHERE DESCR IS NOT NULL AND TRIM(DESCR) IS NOT NULL ORDER BY 1")
        return [{"descr": (r[0] or "").strip()} for r in cursor.fetchall() if (r[0] or "").strip()]
    except Exception as e:
        print(f"[REFERENCE] qualifications failed: {e}")
        return []
    finally:
        cursor.close(); conn.close()


# ─────────────────────────────────────────────────────────────────
# ADD / REMOVE for the new per-company lookups (Setup section).
# Each entry is owned by a company (UNIT_ID); seed/global rows (UNIT_ID IS NULL)
# are shown to everyone but can only be removed where company-owned.
# ─────────────────────────────────────────────────────────────────

def _next_code(cursor, table: str, col: str) -> str:
    cursor.execute(
        f"SELECT NVL(MAX(TO_NUMBER({col})), 0) + 1 FROM {table} "
        f"WHERE REGEXP_LIKE({col}, '^[0-9]+$')")
    return str(int(cursor.fetchone()[0]))


def add_emp_status(descr: str, compc=None) -> dict:
    conn = get_connection(); cursor = conn.cursor()
    try:
        code = _next_code(cursor, "HR_EMP_STATUS", "EMP_STATUS")
        d = descr.strip()
        _insert_progressive(cursor, conn, [
            ("INSERT INTO HR_EMP_STATUS (EMP_STATUS, EMP_STATUS_DESC, UNIT_ID) VALUES (:c, :d, :u)",
             {"c": code, "d": d, "u": _coerce(compc)}),
            ("INSERT INTO HR_EMP_STATUS (EMP_STATUS, EMP_STATUS_DESC) VALUES (:c, :d)",
             {"c": code, "d": d}),
        ])
        return {"status": "success", "emp_status": code, "descr": d}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def delete_emp_status(emp_status: str, compc=None) -> dict:
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute(
            "DELETE FROM HR_EMP_STATUS WHERE EMP_STATUS = :c AND UNIT_ID = :u",
            {"c": str(emp_status), "u": _coerce(compc)})
        conn.commit()
        if cursor.rowcount == 0:
            return {"status": "error", "message": "Only entries added for this company can be removed."}
        return {"status": "success"}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def add_bank(bnkname: str, compc=None) -> dict:
    conn = get_connection(); cursor = conn.cursor()
    try:
        code = _next_code(cursor, "HR_BANK", "BNKCODE")
        nm = bnkname.strip()
        _insert_progressive(cursor, conn, [
            ("INSERT INTO HR_BANK (BNKCODE, BNKNAME, UNIT_ID) VALUES (:c, :n, :u)",
             {"c": code, "n": nm, "u": _coerce(compc)}),
            ("INSERT INTO HR_BANK (BNKCODE, BNKNAME) VALUES (:c, :n)",
             {"c": code, "n": nm}),
        ])
        return {"status": "success", "bnkcode": code, "bnkname": nm}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def delete_bank(bnkcode: str, compc=None) -> dict:
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM HR_BRANCH WHERE BNKCODE = :c AND UNIT_ID = :u",
                       {"c": str(bnkcode), "u": _coerce(compc)})
        cursor.execute("DELETE FROM HR_BANK WHERE BNKCODE = :c AND UNIT_ID = :u",
                       {"c": str(bnkcode), "u": _coerce(compc)})
        conn.commit()
        if cursor.rowcount == 0:
            return {"status": "error", "message": "Only banks added for this company can be removed."}
        return {"status": "success"}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def add_bank_branch(bnkcode: str, brnname: str, compc=None) -> dict:
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT NVL(MAX(TO_NUMBER(BRNCODE)), 0) + 1 FROM HR_BRANCH "
            "WHERE BNKCODE = :b AND REGEXP_LIKE(BRNCODE, '^[0-9]+$')", {"b": str(bnkcode)})
        code = str(int(cursor.fetchone()[0]))
        nm = brnname.strip()
        _insert_progressive(cursor, conn, [
            ("INSERT INTO HR_BRANCH (BNKCODE, BRNCODE, BRNNAME, UNIT_ID) VALUES (:b, :c, :n, :u)",
             {"b": str(bnkcode), "c": code, "n": nm, "u": _coerce(compc)}),
            ("INSERT INTO HR_BRANCH (BNKCODE, BRNCODE, BRNNAME) VALUES (:b, :c, :n)",
             {"b": str(bnkcode), "c": code, "n": nm}),
        ])
        return {"status": "success", "bnkcode": str(bnkcode), "brncode": code, "brnname": nm}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def delete_bank_branch(bnkcode: str, brncode: str, compc=None) -> dict:
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute(
            "DELETE FROM HR_BRANCH WHERE BNKCODE = :b AND BRNCODE = :c AND UNIT_ID = :u",
            {"b": str(bnkcode), "c": str(brncode), "u": _coerce(compc)})
        conn.commit()
        if cursor.rowcount == 0:
            return {"status": "error", "message": "Only branches added for this company can be removed."}
        return {"status": "success"}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def add_qualification(descr: str, compc=None) -> dict:
    """Register a qualification option (Q_TYPE='OPT' template row) for a company."""
    conn = get_connection(); cursor = conn.cursor()
    try:
        d = descr.strip()
        _insert_progressive(cursor, conn, [
            ("INSERT INTO HR_EMP_QUALIFICATION (DESCR, Q_TYPE, UNIT_ID) VALUES (:d, 'OPT', :u)",
             {"d": d, "u": _coerce(compc)}),
            ("INSERT INTO HR_EMP_QUALIFICATION (DESCR, Q_TYPE) VALUES (:d, 'OPT')",
             {"d": d}),
        ])
        return {"status": "success", "descr": d}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def delete_qualification(descr: str, compc=None) -> dict:
    """Remove a qualification OPTION (only the Q_TYPE='OPT' template rows — never
    real employee qualification records)."""
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute(
            "DELETE FROM HR_EMP_QUALIFICATION WHERE TRIM(DESCR) = :d AND Q_TYPE = 'OPT' AND UNIT_ID = :u",
            {"d": descr.strip(), "u": _coerce(compc)})
        conn.commit()
        if cursor.rowcount == 0:
            return {"status": "error", "message": "Only options added for this company can be removed."}
        return {"status": "success"}
    except Exception as e:
        conn.rollback(); return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def get_designations(grade_cd: str = None, compc=None, brnch=None) -> list:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # For designations we keep grade_cd as a regular filter and add compc/brnch progressively.
        base_filter = "1=1"
        if grade_cd:
            base_filter += " AND GRADE_CD = :gradecd"
        template = f"SELECT GRADE_CD, DESG_CD, DESG_DESC FROM HR_DESG WHERE {base_filter} {{filter}} ORDER BY GRADE_CD, DESG_CD"
        # _try_progressive doesn't know about :gradecd, so we inline it via a closure
        attempts = []
        base_params = {"gradecd": grade_cd} if grade_cd else {}
        if compc and brnch:
            attempts.append(("AND COMPC = :fcompc AND BRNCH = :fbrnch",
                             {**base_params, "fcompc": _coerce(compc), "fbrnch": _coerce(brnch)}))
        if compc:
            attempts.append(("AND COMPC = :fcompc",
                             {**base_params, "fcompc": _coerce(compc)}))
        if brnch:
            attempts.append(("AND BRNCH = :fbrnch",
                             {**base_params, "fbrnch": _coerce(brnch)}))
        attempts.append(("", base_params))

        rows = []
        for filter_sql, params in attempts:
            try:
                cursor.execute(template.replace("{filter}", filter_sql), params)
                rows = cursor.fetchall()
                break
            except Exception as e:
                if "ORA-00904" in str(e):
                    continue
                raise
        return [{"grade_cd": (r[0] or "").strip(), "desg_cd": str(r[1]).strip(), "desg_desc": (r[2] or "").strip()} for r in rows]
    finally:
        cursor.close(); conn.close()


# SHIFT_HEAD columns. PK/COMPC/BRNCH are managed server-side; the rest are the
# editable shift-timing fields exposed on the Setup → Shifts form.
SHIFT_HEAD_COLS = [
    "SHIFT_HEAD_PK", "SHIFT", "SHIFT_DESC", "TIME_FROM", "TIME_TO",
    "OVERTIME_START_TIME", "ALLOW_IN_TIME", "LATE_START_TM",
     
    "HALF_DAY_TM", "LATE_SIT_TM", "LATE_SIT_ALLOW_TM",
    "DUTY_HRS", "EARLY_OUT_LATE_START", "EARLY_OUT_LATE_END",
    "EARLY_OUT_HDAY_START", "EARLY_OUT_HDAY_END",
    "LATE_END_TM", "HALF_DAY_END_TM", "DAY_NAME", "COMPC", "BRNCH",
]
SHIFT_HEAD_FIELDS = [c for c in SHIFT_HEAD_COLS if c not in ("SHIFT_HEAD_PK", "COMPC", "BRNCH")]


def get_shifts(compc=None, brnch=None) -> list:
    """All SHIFT_HEAD rows for the company/branch, with every timing column."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        col_sql = ", ".join(SHIFT_HEAD_COLS)
        rows = _try_progressive(
            cursor,
            f"SELECT {col_sql} FROM SHIFT_HEAD WHERE 1=1 {{filter}} ORDER BY SHIFT",
            compc, brnch,
        )
        out = []
        for r in rows:
            d = {}
            for i, c in enumerate(SHIFT_HEAD_COLS):
                v = r[i]
                d[c.lower()] = v.strip() if isinstance(v, str) else v
            out.append(d)
        return out
    finally:
        cursor.close(); conn.close()


def get_shift_lov() -> list:
    """The shift LOV (master list of shift codes) from HR_SHIFT — active only."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT SHIFT, DESCR FROM HR_SHIFT WHERE NVL(STATS, 'Y') = 'Y' ORDER BY SHIFT"
        )
        return [{"shift": (r[0] or "").strip(), "descr": (r[1] or "").strip()}
                for r in cursor.fetchall()]
    finally:
        cursor.close(); conn.close()


def _shift_field_value(col: str, fields: dict):
    """Normalise one incoming SHIFT_HEAD field value for binding."""
    raw = fields.get(col.lower())
    if raw is None:
        return None
    s = str(raw).strip()
    if s == "":
        return None
    if col == "SHIFT":
        return s.upper()[:1]
    if col == "DUTY_HRS":
        try:
            return float(s)
        except ValueError:
            return None
    return s[:20]


def add_shift_head(fields: dict, compc=1, brnch=1) -> dict:
    """Insert a full shift configuration into SHIFT_HEAD for this company+branch."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        shift = (fields.get("shift") or "").strip().upper()[:1]
        if not shift:
            return {"status": "error", "message": "Shift code is required"}

        # One configuration per shift code per company+branch.
        cursor.execute(
            "SELECT COUNT(*) FROM SHIFT_HEAD WHERE SHIFT = :s "
            "AND NVL(COMPC, 0) = :c AND NVL(BRNCH, 0) = :b",
            {"s": shift, "c": _coerce(compc), "b": _coerce(brnch)},
        )
        if cursor.fetchone()[0] > 0:
            return {"status": "error",
                    "message": f"Shift '{shift}' is already configured for this company/branch"}

        cursor.execute("SELECT NVL(MAX(SHIFT_HEAD_PK), 0) + 1 FROM SHIFT_HEAD")
        new_pk = cursor.fetchone()[0]

        cols = ["SHIFT_HEAD_PK"] + SHIFT_HEAD_FIELDS + ["COMPC", "BRNCH"]
        binds = {"SHIFT_HEAD_PK": new_pk, "COMPC": _coerce(compc), "BRNCH": _coerce(brnch)}
        for c in SHIFT_HEAD_FIELDS:
            binds[c] = _shift_field_value(c, fields)

        placeholders = ", ".join(":" + c for c in cols)
        cursor.execute(
            f"INSERT INTO SHIFT_HEAD ({', '.join(cols)}) VALUES ({placeholders})", binds
        )
        conn.commit()
        return {"status": "success", "shift": shift, "shift_head_pk": new_pk}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def update_shift_head(pk, fields: dict) -> dict:
    """Update every editable timing column of a SHIFT_HEAD row by PK."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        set_parts, binds = [], {"pk": pk}
        for c in SHIFT_HEAD_FIELDS:
            set_parts.append(f"{c} = :{c}")
            binds[c] = _shift_field_value(c, fields)
        cursor.execute(
            f"UPDATE SHIFT_HEAD SET {', '.join(set_parts)} WHERE SHIFT_HEAD_PK = :pk", binds
        )
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def delete_shift_head(pk) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM SHIFT_HEAD WHERE SHIFT_HEAD_PK = :pk", {"pk": pk})
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def get_blood_groups(compc=None, brnch=None) -> list:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        rows = _try_progressive(
            cursor,
            "SELECT BLOOD_GROUP_PK, BLOOD_GROUP FROM BLOOD_GROUP WHERE 1=1 {filter} ORDER BY BLOOD_GROUP_PK",
            compc, brnch,
        )
        return [{"pk": r[0], "blood_group": r[1]} for r in rows]
    finally:
        cursor.close(); conn.close()


def get_cadre(compc=None, brnch=None) -> list:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        rows = _try_progressive(
            cursor,
            "SELECT CADRE_PK, CADRE FROM CADRE WHERE 1=1 {filter} ORDER BY CADRE",
            compc, brnch,
        )
        return [{"pk": r[0], "cadre": r[1]} for r in rows]
    finally:
        cursor.close(); conn.close()


def get_units() -> list:
    # Units ARE the company list — never filter by company
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT UNIT_ID, UNIT_NAME FROM UNIT_MST ORDER BY UNIT_NAME")
        return [{"unit_id": r[0], "unit_name": (r[1] or "").strip()} for r in cursor.fetchall()]
    finally:
        cursor.close(); conn.close()


# ─────────────────────────────────────────────────────────────────
# ADD FUNCTIONS (HR admin only)
# ─────────────────────────────────────────────────────────────────

def _insert_progressive(cursor, conn, attempts):
    """Try each (sql, params) attempt in order. On ORA-00904 (a referenced column
    does not exist in this schema) roll back and fall through to the next, simpler
    attempt. Commits and returns on the first success; re-raises other errors."""
    last_err = None
    for sql, params in attempts:
        try:
            cursor.execute(sql, params)
            conn.commit()
            return
        except Exception as e:
            if "ORA-00904" in str(e):
                conn.rollback()
                last_err = e
                continue
            raise
    if last_err:
        raise last_err


def add_department(dept_name: str, compc=1, brnch=1) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT NVL(MAX(DEPT_NO), 0) + 1 FROM HR_DEPT")
        new_pk = cursor.fetchone()[0]
        name = dept_name.strip()
        # HR_DEPT has a NOT NULL COMPC (and usually BRNCH). Try the fullest insert
        # first, falling back if a column doesn't exist in this schema.
        _insert_progressive(cursor, conn, [
            ("INSERT INTO HR_DEPT (DEPT_NO, DEPT_NAME, COMPC, BRNCH) VALUES (:pk, :name, :compc, :brnch)",
             {"pk": new_pk, "name": name, "compc": compc, "brnch": brnch}),
            ("INSERT INTO HR_DEPT (DEPT_NO, DEPT_NAME, COMPC) VALUES (:pk, :name, :compc)",
             {"pk": new_pk, "name": name, "compc": compc}),
            ("INSERT INTO HR_DEPT (DEPT_NO, DEPT_NAME) VALUES (:pk, :name)",
             {"pk": new_pk, "name": name}),
        ])
        return {"status": "success", "dept_no": new_pk, "dept_name": name}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def add_grade(grade_cd: str, descr: str, compc=1, brnch=1) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cd = grade_cd.strip()
        ds = descr.strip()
        _insert_progressive(cursor, conn, [
            ("INSERT INTO HR_GRADE_CD (GRADE_CD, DESCR, STATUS, COMPC, BRNCH) VALUES (:cd, :descr, 'A', :compc, :brnch)",
             {"cd": cd, "descr": ds, "compc": compc, "brnch": brnch}),
            ("INSERT INTO HR_GRADE_CD (GRADE_CD, DESCR, STATUS, COMPC) VALUES (:cd, :descr, 'A', :compc)",
             {"cd": cd, "descr": ds, "compc": compc}),
            ("INSERT INTO HR_GRADE_CD (GRADE_CD, DESCR, STATUS) VALUES (:cd, :descr, 'A')",
             {"cd": cd, "descr": ds}),
        ])
        return {"status": "success", "grade_cd": cd, "descr": ds}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def add_designation(grade_cd: str, desg_desc: str, compc=1, brnch=1) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "SELECT NVL(MAX(DESG_CD), 0) + 1 FROM HR_DESG WHERE GRADE_CD = :g",
            {"g": grade_cd}
        )
        new_cd = cursor.fetchone()[0]
        dd = desg_desc.strip()
        _insert_progressive(cursor, conn, [
            ("INSERT INTO HR_DESG (GRADE_CD, DESG_CD, DESG_DESC, COMPC, BRNCH) VALUES (:g, :cd, :desg_text, :compc, :brnch)",
             {"g": grade_cd, "cd": new_cd, "desg_text": dd, "compc": compc, "brnch": brnch}),
            ("INSERT INTO HR_DESG (GRADE_CD, DESG_CD, DESG_DESC, COMPC) VALUES (:g, :cd, :desg_text, :compc)",
             {"g": grade_cd, "cd": new_cd, "desg_text": dd, "compc": compc}),
            ("INSERT INTO HR_DESG (GRADE_CD, DESG_CD, DESG_DESC) VALUES (:g, :cd, :desg_text)",
             {"g": grade_cd, "cd": new_cd, "desg_text": dd}),
        ])
        return {"status": "success", "grade_cd": grade_cd, "desg_cd": str(new_cd), "desg_desc": dd}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def add_blood_group(blood_group: str, compc=1, brnch=1) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT NVL(MAX(BLOOD_GROUP_PK), 0) + 1 FROM BLOOD_GROUP")
        new_pk = cursor.fetchone()[0]
        cursor.execute(
            "INSERT INTO BLOOD_GROUP (BLOOD_GROUP_PK, BLOOD_GROUP, COMPC, BRNCH) VALUES (:pk, :bg, :compc, :brnch)",
            {"pk": new_pk, "bg": blood_group.strip(), "compc": compc, "brnch": brnch}
        )
        conn.commit()
        return {"status": "success", "pk": new_pk, "blood_group": blood_group.strip()}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def add_cadre(cadre: str, compc=1, brnch=1) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT NVL(MAX(CADRE_PK), 0) + 1 FROM CADRE")
        new_pk = cursor.fetchone()[0]
        cursor.execute(
            "INSERT INTO CADRE (CADRE_PK, CADRE, COMPC, BRNCH) VALUES (:pk, :c, :compc, :brnch)",
            {"pk": new_pk, "c": cadre.strip(), "compc": compc, "brnch": brnch}
        )
        conn.commit()
        return {"status": "success", "pk": new_pk, "cadre": cadre.strip()}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def get_locations(allowed_branches=None, compc=None) -> list:
    """Return locations (branches) from COM_LOCATION.
    - compc: when given, only branches of that company (COM_LOCATION.COMPC).
    - allowed_branches: when given (list of branch codes), only those LCODEs
      (the admin's branch rights).
    """
    conn = get_connection()
    cursor = conn.cursor()
    try:
        params = {}
        conds = []
        if compc is not None and str(compc).strip() != "":
            conds.append("TO_CHAR(COMPC) = TO_CHAR(:cmp)")
            params["cmp"] = str(compc).strip()
        if allowed_branches:
            nums = []
            for b in allowed_branches:
                try:
                    nums.append(int(float(str(b).strip())))
                except (ValueError, TypeError):
                    pass
            if nums:
                ph = ", ".join(f":lc{i}" for i in range(len(nums)))
                conds.append(f"TO_NUMBER(LCODE) IN ({ph})")
                for i, n in enumerate(nums):
                    params[f"lc{i}"] = n
        where = (" WHERE " + " AND ".join(conds)) if conds else ""

        cursor.execute(
            f"SELECT LCODE, DESCR, SNAME, NVL(REGIONCODE,'') AS REGIONCODE, NVL(CITY,'') AS CITY"
            f" FROM COM_LOCATION{where} ORDER BY LPAD(LCODE, 6)",
            params,
        )
        return [
            {
                "lcode": str(r[0] or "").strip(),
                "descr": (r[1] or "").strip(),
                "sname": (r[2] or "").strip(),
                "regioncode": (r[3] or "").strip(),
                "city": (r[4] or "").strip(),
            }
            for r in cursor.fetchall()
        ]
    finally:
        cursor.close(); conn.close()


def add_location(lcode: str, descr: str, sname: str, regioncode: str, city: str, compc=None) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "INSERT INTO COM_LOCATION (LCODE, DESCR, SNAME, REGIONCODE, CITY, COMPC)"
            " VALUES (:lcode, :descr, :sname, :region, :city, :compc)",
            {"lcode": lcode.strip(), "descr": descr.strip(), "sname": (sname or descr).strip(),
             "region": regioncode.strip(), "city": city.strip(),
             "compc": (str(compc).strip() if compc is not None and str(compc).strip() != "" else None)}
        )
        conn.commit()
        return {"status": "success", "lcode": lcode.strip()}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def update_location(lcode: str, descr: str, sname: str, regioncode: str, city: str) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "UPDATE COM_LOCATION SET DESCR=:descr, SNAME=:sname, REGIONCODE=:region, CITY=:city WHERE LCODE=:lcode",
            {"lcode": lcode.strip(), "descr": descr.strip(), "sname": (sname or descr).strip(), "region": regioncode.strip(), "city": city.strip()}
        )
        conn.commit()
        if cursor.rowcount == 0:
            return {"status": "error", "message": f"Location {lcode} not found"}
        return {"status": "success", "lcode": lcode.strip()}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()


def get_religions() -> list:
    """Return distinct religion codes already in HR_EMP_MASTER, plus defaults."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT DISTINCT RELIGION FROM HR_EMP_MASTER
            WHERE RELIGION IS NOT NULL AND TRIM(RELIGION) IS NOT NULL
            ORDER BY RELIGION
        """)
        existing = {r[0].strip() for r in cursor.fetchall() if r[0] and r[0].strip()}
        # Built-in 4-char defaults always available
        defaults = ["ISLM", "CHRS", "HIND", "BUDH", "JAIN", "SIKK", "OTHR"]
        combined = sorted(existing | set(defaults))
        label_map = {
            "ISLM": "Islam", "CHRS": "Christian", "HIND": "Hindu",
            "BUDH": "Buddhist", "JAIN": "Jain", "SIKK": "Sikh", "OTHR": "Other",
        }
        return [{"code": c, "label": label_map.get(c, c)} for c in combined]
    finally:
        cursor.close()
        conn.close()


def get_reporting_officers(compc=None, brnch=None) -> list:
    """Return active employees for use as reporting officer options,
    restricted to the selected company/branch (HR_EMP_MASTER.UNIT_ID / LOCATION)."""
    conn = get_connection()
    cursor = conn.cursor()

    def _ints(v):
        if v is None or v == "":
            return []
        vals = v if isinstance(v, (list, tuple)) else [v]
        out = []
        for x in vals:
            try:
                out.append(int(float(str(x).strip())))
            except (ValueError, TypeError):
                continue
        return out

    base = "(STATUS = 'A' OR STATUS IS NULL)", "NAME IS NOT NULL"
    comp_nums = _ints(compc)
    brn_nums = _ints(brnch)

    # Build progressively-less-restrictive attempts. TO_NUMBER on UNIT_ID/LOCATION
    # can raise ORA-01722 if a row holds non-numeric data, so each attempt falls
    # back to a simpler filter rather than letting the error surface as a 500.
    attempts = []
    if comp_nums and brn_nums:
        p = {}
        cph = ", ".join(f":c{i}" for i in range(len(comp_nums)))
        bph = ", ".join(f":b{i}" for i in range(len(brn_nums)))
        for i, n in enumerate(comp_nums): p[f"c{i}"] = n
        for i, n in enumerate(brn_nums): p[f"b{i}"] = n
        attempts.append((f"{base[0]} AND {base[1]} AND TO_NUMBER(UNIT_ID) IN ({cph}) AND TO_NUMBER(LOCATION) IN ({bph})", p))
    if comp_nums:
        p = {f"c{i}": n for i, n in enumerate(comp_nums)}
        cph = ", ".join(f":c{i}" for i in range(len(comp_nums)))
        attempts.append((f"{base[0]} AND {base[1]} AND TO_NUMBER(UNIT_ID) IN ({cph})", p))
    attempts.append((f"{base[0]} AND {base[1]}", {}))

    try:
        last_err = None
        for where, params in attempts:
            try:
                cursor.execute(f"SELECT EMPCODE, NAME FROM HR_EMP_MASTER WHERE {where} ORDER BY NAME", params)
                return [{"empcode": r[0], "name": (r[1] or "").strip()} for r in cursor.fetchall()]
            except Exception as e:
                last_err = e
                print(f"[REPORTING_OFFICERS] filter attempt failed, falling back: {e}")
                continue
        print(f"[REPORTING_OFFICERS] all attempts failed: {last_err}")
        return []
    finally:
        cursor.close()
        conn.close()


def add_unit(unit_name: str) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT NVL(MAX(UNIT_ID), 0) + 1 FROM UNIT_MST")
        new_pk = cursor.fetchone()[0]
        cursor.execute(
            "INSERT INTO UNIT_MST (UNIT_ID, UNIT_NAME) VALUES (:pk, :name)",
            {"pk": new_pk, "name": unit_name.strip()}
        )
        conn.commit()
        return {"status": "success", "unit_id": new_pk, "unit_name": unit_name.strip()}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close(); conn.close()
