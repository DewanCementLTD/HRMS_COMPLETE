"""Recruitment repository — CRUD on RECRUITMENT_* tables.

Optional company/branch scoping: if RECRUITMENT_JOBS has COMPC / BRNCH columns
(added via migration), jobs are stamped with and filtered by the admin's
company/branch. The code uses progressive fallback so it works unchanged when
those columns do not yet exist.

    -- Migration to enable per-company/branch recruitment:
    ALTER TABLE RECRUITMENT_JOBS ADD (COMPC NUMBER, BRNCH NUMBER);
"""

from core.database import get_connection


def _r_to_int(v):
    try:
        return int(float(str(v).strip()))
    except (ValueError, TypeError):
        return None


_recruitment_cols_ready = False


def ensure_recruitment_company_columns():
    """Idempotently add COMPC / BRNCH to RECRUITMENT_JOBS and backfill existing
    rows from each job's creator (CREATED_BY → HR_EMP_MASTER company/branch), so
    per-company/branch recruitment activates without a manual migration. Safe to
    call repeatedly; degrades gracefully if the DB user can't run DDL."""
    global _recruitment_cols_ready
    if _recruitment_cols_ready:
        return
    conn = get_connection()
    cursor = conn.cursor()
    try:
        for col in ("COMPC", "BRNCH"):
            try:
                cursor.execute(f"ALTER TABLE RECRUITMENT_JOBS ADD ({col} NUMBER)")
                print(f"[RECRUITMENT] Added column {col} to RECRUITMENT_JOBS")
            except Exception as e:
                # ORA-01430: column already exists → fine. Anything else (e.g. no
                # ALTER privilege) is logged; filtering then degrades to unscoped.
                if "ORA-01430" not in str(e):
                    print(f"[RECRUITMENT] Could not add {col}: {str(e).splitlines()[0]}")

        # Backfill company/branch on legacy rows from the creating admin's record.
        for col, src in (("COMPC", "h.UNIT_ID"), ("BRNCH", "h.LOCATION")):
            try:
                cursor.execute(f"""
                    UPDATE RECRUITMENT_JOBS j
                    SET {col} = (
                        SELECT TO_NUMBER({src})
                        FROM HR_EMP_MASTER h
                        LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
                        WHERE TO_CHAR(e.CARD_NO) = j.CREATED_BY
                           OR TO_CHAR(h."ATDTCARD#") = j.CREATED_BY
                           OR h.EMPCODE = j.CREATED_BY
                        FETCH FIRST 1 ROWS ONLY
                    )
                    WHERE j.{col} IS NULL
                """)
                conn.commit()
            except Exception as e:
                conn.rollback()
                print(f"[RECRUITMENT] {col} backfill skipped: {str(e).splitlines()[0]}")

        _recruitment_cols_ready = True
    except Exception as e:
        print(f"[RECRUITMENT] column setup failed: {e}")
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# JOBS
# ------------------------------------------------------------------

def create_job(data: dict, created_by: str, compc=None, brnch=None) -> dict:
    ensure_recruitment_company_columns()
    conn = get_connection()
    cursor = conn.cursor()
    base = {
        "job_title": data.get("job_title"),
        "dept_no": data.get("dept_no"),
        "open_positions": data.get("open_positions", 1),
        "job_desc": data.get("job_desc"),
        "skills_req": data.get("skills_req"),
        "created_by": created_by,
    }
    cval = _r_to_int(compc)
    bval = _r_to_int(brnch)
    # Try fullest insert first; fall back if COMPC/BRNCH columns don't exist.
    attempts = []
    if cval is not None or bval is not None:
        attempts.append((
            """INSERT INTO RECRUITMENT_JOBS (
                JOB_ID, JOB_TITLE, DEPT_NO, OPEN_POSITIONS, JOB_DESC, SKILLS_REQ,
                STATUS, CREATED_BY, CREATED_AT, UPDATED_AT, COMPC, BRNCH
            ) VALUES (
                RECRUITMENT_JOBS_SEQ.NEXTVAL, :job_title, :dept_no, :open_positions,
                :job_desc, :skills_req, 'OPEN', :created_by, SYSDATE, SYSDATE, :compc, :brnch
            )""",
            {**base, "compc": cval, "brnch": bval},
        ))
    attempts.append((
        """INSERT INTO RECRUITMENT_JOBS (
            JOB_ID, JOB_TITLE, DEPT_NO, OPEN_POSITIONS, JOB_DESC, SKILLS_REQ,
            STATUS, CREATED_BY, CREATED_AT, UPDATED_AT
        ) VALUES (
            RECRUITMENT_JOBS_SEQ.NEXTVAL, :job_title, :dept_no, :open_positions,
            :job_desc, :skills_req, 'OPEN', :created_by, SYSDATE, SYSDATE
        )""",
        base,
    ))
    try:
        last_err = None
        for sql, params in attempts:
            try:
                cursor.execute(sql, params)
                conn.commit()
                return {"status": "success"}
            except Exception as e:
                if "ORA-00904" in str(e):
                    conn.rollback(); last_err = e; continue
                raise
        return {"status": "error", "message": str(last_err)}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


def _job_scope_filter(params: dict, compc=None, brnch=None) -> str:
    """Build a scope fragment. Company is strict (a job belongs to one company);
    branch matches the selected branch(es) OR NULL (company-wide jobs that were
    created under "All Branches" stay visible in every branch of the company).
    Caller retries without this fragment if the columns are absent (ORA-00904)."""
    parts = []
    cnums = [n for n in (_r_to_int(c) for c in (compc or [])) if n is not None] if isinstance(compc, (list, tuple)) else ([_r_to_int(compc)] if _r_to_int(compc) is not None else [])
    bnums = [n for n in (_r_to_int(b) for b in (brnch or [])) if n is not None] if isinstance(brnch, (list, tuple)) else ([_r_to_int(brnch)] if _r_to_int(brnch) is not None else [])
    if cnums:
        ph = ", ".join(f":jc{i}" for i in range(len(cnums)))
        parts.append(f"j.COMPC IN ({ph})")
        for i, n in enumerate(cnums): params[f"jc{i}"] = n
    if bnums:
        ph = ", ".join(f":jb{i}" for i in range(len(bnums)))
        parts.append(f"(j.BRNCH IN ({ph}) OR j.BRNCH IS NULL)")
        for i, n in enumerate(bnums): params[f"jb{i}"] = n
    return (" AND " + " AND ".join(parts)) if parts else ""


def _scoped_list(cursor, sql_with_placeholder: str, base_conditions: list,
                 base_params: dict, compc=None, brnch=None) -> list:
    """Run a recruitment list query scoped to the selected company/branch via the
    job's COMPC/BRNCH. The SQL must JOIN RECRUITMENT_JOBS j and contain the literal
    token __WHERE__ where its WHERE clause belongs. Falls back to unscoped when the
    COMPC/BRNCH columns are absent (ORA-00904)."""
    base_where = ("WHERE " + " AND ".join(base_conditions)) if base_conditions else ""

    def _run(where: str, params: dict) -> list:
        cursor.execute(sql_with_placeholder.replace("__WHERE__", where), params)
        rows = cursor.fetchall()
        cols = [c[0].lower() for c in cursor.description]
        return [dict(zip(cols, r)) for r in rows]

    scoped_params = dict(base_params)
    scope = _job_scope_filter(scoped_params, compc, brnch)
    if scope:
        where = (base_where + scope) if base_where else ("WHERE 1=1" + scope)
        try:
            return _run(where, scoped_params)
        except Exception as e:
            if "ORA-00904" not in str(e):
                raise
            print(f"[RECRUITMENT] COMPC/BRNCH absent, listing unscoped: {e}")
    return _run(base_where, base_params)


def list_jobs(status: str = None, compc=None, brnch=None) -> list:
    ensure_recruitment_company_columns()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # Try scoped by company/branch first; if those columns don't exist
        # (ORA-00904), fall back to the unscoped list.
        scope_params: dict = {}
        scope = _job_scope_filter(scope_params, compc, brnch)
        if scope:
            params = {**scope_params}
            conds = []
            if status:
                conds.append("j.STATUS = :status"); params["status"] = status
            where = "WHERE " + (" AND ".join(conds) if conds else "1=1") + scope
            try:
                return _jobs_query(cursor, where, params)
            except Exception as e:
                if "ORA-00904" in str(e):
                    print(f"[RECRUITMENT] COMPC/BRNCH columns absent, listing unscoped: {e}")
                else:
                    raise

        where = "WHERE j.STATUS = :status" if status else ""
        params = {"status": status} if status else {}
        return _jobs_query(cursor, where, params)
    finally:
        cursor.close()
        conn.close()


def _jobs_query(cursor, where: str, params: dict) -> list:
    cursor.execute(f"""
            SELECT
                j.JOB_ID,
                j.JOB_TITLE,
                j.DEPT_NO,
                NVL(d.DEPT_NAME, TO_CHAR(j.DEPT_NO)) AS DEPT_NAME,
                j.OPEN_POSITIONS,
                (SELECT COUNT(*) FROM RECRUITMENT_OFFERS o
                 JOIN RECRUITMENT_APPLICATIONS a2 ON a2.APP_ID = o.APP_ID
                 WHERE a2.JOB_ID = j.JOB_ID AND o.STATUS = 'ACCEPTED') AS FILLED_POSITIONS,
                j.JOB_DESC,
                j.SKILLS_REQ,
                j.STATUS,
                j.CREATED_BY,
                TO_CHAR(j.CREATED_AT, 'YYYY-MM-DD') AS CREATED_AT
            FROM RECRUITMENT_JOBS j
            LEFT JOIN HR_DEPT d ON d.DEPT_NO = j.DEPT_NO
            {where}
            ORDER BY j.JOB_ID DESC
    """, params)
    rows = cursor.fetchall()
    columns = [col[0].lower() for col in cursor.description]
    result = []
    for r in rows:
        row = dict(zip(columns, r))
        filled = int(row.get("filled_positions") or 0)
        open_pos = int(row.get("open_positions") or 0)
        row["filled_positions"] = filled
        row["remaining_positions"] = max(open_pos - filled, 0)
        result.append(row)
    return result


def get_job(job_id: int) -> dict | None:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT
                j.JOB_ID,
                j.JOB_TITLE,
                j.DEPT_NO,
                NVL(d.DEPT_NAME, TO_CHAR(j.DEPT_NO)) AS DEPT_NAME,
                j.OPEN_POSITIONS,
                (SELECT COUNT(*) FROM RECRUITMENT_OFFERS o
                 JOIN RECRUITMENT_APPLICATIONS a2 ON a2.APP_ID = o.APP_ID
                 WHERE a2.JOB_ID = j.JOB_ID AND o.STATUS = 'ACCEPTED') AS FILLED_POSITIONS,
                j.JOB_DESC,
                j.SKILLS_REQ,
                j.STATUS,
                j.CREATED_BY,
                TO_CHAR(j.CREATED_AT, 'YYYY-MM-DD') AS CREATED_AT
            FROM RECRUITMENT_JOBS j
            LEFT JOIN HR_DEPT d ON d.DEPT_NO = j.DEPT_NO
            WHERE j.JOB_ID = :job_id
        """, {"job_id": job_id})
        row = cursor.fetchone()
        if not row:
            return None
        columns = [col[0].lower() for col in cursor.description]
        result = dict(zip(columns, row))
        filled = int(result.get("filled_positions") or 0)
        open_pos = int(result.get("open_positions") or 0)
        result["filled_positions"] = filled
        result["remaining_positions"] = max(open_pos - filled, 0)
        return result
    finally:
        cursor.close()
        conn.close()


def update_job(job_id: int, data: dict) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    field_map = {
        "job_title": "JOB_TITLE",
        "dept_no": "DEPT_NO",
        "open_positions": "OPEN_POSITIONS",
        "job_desc": "JOB_DESC",
        "skills_req": "SKILLS_REQ",
        "status": "STATUS",
    }
    set_parts = ["UPDATED_AT = SYSDATE"]
    params = {"job_id": job_id}
    for key, col in field_map.items():
        if key in data and data[key] is not None:
            set_parts.append(f"{col} = :{key}")
            params[key] = data[key]
    if len(set_parts) == 1:
        return {"status": "error", "message": "No fields to update"}
    try:
        cursor.execute(
            f"UPDATE RECRUITMENT_JOBS SET {', '.join(set_parts)} WHERE JOB_ID = :job_id",
            params,
        )
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# APPLICATIONS
# ------------------------------------------------------------------

def create_application(data: dict) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO RECRUITMENT_APPLICATIONS (
                APP_ID, JOB_ID, CANDIDATE_NAME, MOBILE, EMAIL,
                SOURCE, APP_DATE, STATUS, NOTES, CREATED_AT
            ) VALUES (
                RECRUITMENT_APPS_SEQ.NEXTVAL, :job_id, :candidate_name,
                :mobile, :email, :source, SYSDATE, 'PENDING', :notes, SYSDATE
            )
        """, {
            "job_id": data.get("job_id"),
            "candidate_name": data.get("candidate_name"),
            "mobile": data.get("mobile"),
            "email": data.get("email"),
            "source": data.get("source"),
            "notes": data.get("notes"),
        })
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


def list_applications(job_id: int = None, status: str = None, compc=None, brnch=None) -> list:
    conn = get_connection()
    cursor = conn.cursor()
    conditions = []
    params = {}
    if job_id is not None:
        conditions.append("a.JOB_ID = :job_id")
        params["job_id"] = job_id
    if status:
        conditions.append("a.STATUS = :status")
        params["status"] = status
    sql = """
            SELECT
                a.APP_ID,
                a.JOB_ID,
                j.JOB_TITLE,
                a.CANDIDATE_NAME,
                a.MOBILE,
                a.EMAIL,
                a.SOURCE,
                TO_CHAR(a.APP_DATE, 'YYYY-MM-DD') AS APP_DATE,
                a.STATUS,
                a.NOTES,
                TO_CHAR(a.CREATED_AT, 'YYYY-MM-DD') AS CREATED_AT
            FROM RECRUITMENT_APPLICATIONS a
            JOIN RECRUITMENT_JOBS j ON j.JOB_ID = a.JOB_ID
            __WHERE__
            ORDER BY a.APP_ID DESC
        """
    try:
        return _scoped_list(cursor, sql, conditions, params, compc, brnch)
    finally:
        cursor.close()
        conn.close()


def get_application(app_id: int) -> dict | None:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT
                a.APP_ID, a.JOB_ID, j.JOB_TITLE,
                a.CANDIDATE_NAME, a.MOBILE, a.EMAIL, a.SOURCE,
                TO_CHAR(a.APP_DATE, 'YYYY-MM-DD') AS APP_DATE,
                a.STATUS, a.NOTES,
                TO_CHAR(a.CREATED_AT, 'YYYY-MM-DD') AS CREATED_AT
            FROM RECRUITMENT_APPLICATIONS a
            JOIN RECRUITMENT_JOBS j ON j.JOB_ID = a.JOB_ID
            WHERE a.APP_ID = :app_id
        """, {"app_id": app_id})
        row = cursor.fetchone()
        if not row:
            return None
        columns = [col[0].lower() for col in cursor.description]
        return dict(zip(columns, row))
    finally:
        cursor.close()
        conn.close()


def update_application_status(app_id: int, status: str, notes: str = None) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            UPDATE RECRUITMENT_APPLICATIONS
            SET STATUS = :status, NOTES = NVL(:notes, NOTES)
            WHERE APP_ID = :app_id
        """, {"status": status, "notes": notes, "app_id": app_id})
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# INTERVIEWS
# ------------------------------------------------------------------

def create_interview(data: dict) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO RECRUITMENT_INTERVIEWS (
                INTERVIEW_ID, APP_ID, INTERVIEW_DATE, INTERVIEW_TYPE,
                INTERVIEWER, STATUS, CREATED_AT
            ) VALUES (
                RECRUITMENT_INTERVIEWS_SEQ.NEXTVAL, :app_id,
                TO_DATE(:interview_date, 'YYYY-MM-DD'),
                :interview_type, :interviewer, 'SCHEDULED', SYSDATE
            )
        """, {
            "app_id": data.get("app_id"),
            "interview_date": data.get("interview_date"),
            "interview_type": data.get("interview_type"),
            "interviewer": data.get("interviewer"),
        })
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


def list_interviews(app_id: int = None, status: str = None, compc=None, brnch=None) -> list:
    conn = get_connection()
    cursor = conn.cursor()
    conditions = []
    params = {}
    if app_id is not None:
        conditions.append("i.APP_ID = :app_id")
        params["app_id"] = app_id
    if status:
        conditions.append("i.STATUS = :status")
        params["status"] = status
    sql = """
            SELECT
                i.INTERVIEW_ID,
                i.APP_ID,
                a.CANDIDATE_NAME,
                j.JOB_TITLE,
                TO_CHAR(i.INTERVIEW_DATE, 'YYYY-MM-DD') AS INTERVIEW_DATE,
                i.INTERVIEW_TYPE,
                i.INTERVIEWER,
                i.STATUS,
                i.FEEDBACK,
                TO_CHAR(i.CREATED_AT, 'YYYY-MM-DD') AS CREATED_AT
            FROM RECRUITMENT_INTERVIEWS i
            JOIN RECRUITMENT_APPLICATIONS a ON a.APP_ID = i.APP_ID
            JOIN RECRUITMENT_JOBS j ON j.JOB_ID = a.JOB_ID
            __WHERE__
            ORDER BY i.INTERVIEW_ID DESC
        """
    try:
        return _scoped_list(cursor, sql, conditions, params, compc, brnch)
    finally:
        cursor.close()
        conn.close()


def update_interview(interview_id: int, data: dict) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    field_map = {
        "status": "STATUS",
        "feedback": "FEEDBACK",
        "interviewer": "INTERVIEWER",
        "interview_type": "INTERVIEW_TYPE",
    }
    set_parts = []
    params = {"interview_id": interview_id}
    for key, col in field_map.items():
        if key in data and data[key] is not None:
            set_parts.append(f"{col} = :{key}")
            params[key] = data[key]
    if "interview_date" in data and data["interview_date"]:
        set_parts.append("INTERVIEW_DATE = TO_DATE(:interview_date, 'YYYY-MM-DD')")
        params["interview_date"] = data["interview_date"]
    if not set_parts:
        return {"status": "error", "message": "No fields to update"}
    try:
        cursor.execute(
            f"UPDATE RECRUITMENT_INTERVIEWS SET {', '.join(set_parts)} WHERE INTERVIEW_ID = :interview_id",
            params,
        )
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# OFFERS
# ------------------------------------------------------------------

def create_offer(data: dict) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO RECRUITMENT_OFFERS (
                OFFER_ID, APP_ID, OFFER_DATE, SALARY_OFFERED, STATUS, NOTES, CREATED_AT
            ) VALUES (
                RECRUITMENT_OFFERS_SEQ.NEXTVAL, :app_id,
                SYSDATE, :salary_offered, 'SENT', :notes, SYSDATE
            )
        """, {
            "app_id": data.get("app_id"),
            "salary_offered": data.get("salary_offered"),
            "notes": data.get("notes"),
        })
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


def list_offers(status: str = None, compc=None, brnch=None) -> list:
    conn = get_connection()
    cursor = conn.cursor()
    conditions = []
    params = {}
    if status:
        conditions.append("o.STATUS = :status")
        params["status"] = status
    sql = """
            SELECT
                o.OFFER_ID,
                o.APP_ID,
                a.CANDIDATE_NAME,
                j.JOB_TITLE,
                TO_CHAR(o.OFFER_DATE, 'YYYY-MM-DD') AS OFFER_DATE,
                o.SALARY_OFFERED,
                o.STATUS,
                o.NOTES,
                TO_CHAR(o.CREATED_AT, 'YYYY-MM-DD') AS CREATED_AT
            FROM RECRUITMENT_OFFERS o
            JOIN RECRUITMENT_APPLICATIONS a ON a.APP_ID = o.APP_ID
            JOIN RECRUITMENT_JOBS j ON j.JOB_ID = a.JOB_ID
            __WHERE__
            ORDER BY o.OFFER_ID DESC
        """
    try:
        return _scoped_list(cursor, sql, conditions, params, compc, brnch)
    finally:
        cursor.close()
        conn.close()


def update_offer(offer_id: int, data: dict) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    field_map = {
        "status": "STATUS",
        "salary_offered": "SALARY_OFFERED",
        "notes": "NOTES",
    }
    set_parts = []
    params = {"offer_id": offer_id}
    for key, col in field_map.items():
        if key in data and data[key] is not None:
            set_parts.append(f"{col} = :{key}")
            params[key] = data[key]
    if not set_parts:
        return {"status": "error", "message": "No fields to update"}
    try:
        cursor.execute(
            f"UPDATE RECRUITMENT_OFFERS SET {', '.join(set_parts)} WHERE OFFER_ID = :offer_id",
            params,
        )
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# ANALYTICS
# ------------------------------------------------------------------

def get_analytics(compc=None, brnch=None) -> dict:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # Build the company/branch scope once (references the RECRUITMENT_JOBS alias j).
        sp: dict = {}
        scope = _job_scope_filter(sp, compc, brnch)
        if scope:
            try:
                return _analytics_query(cursor, scope, sp)
            except Exception as e:
                if "ORA-00904" not in str(e):
                    raise
                print(f"[RECRUITMENT] COMPC/BRNCH absent, analytics unscoped: {e}")
        return _analytics_query(cursor, "", {})
    finally:
        cursor.close()
        conn.close()


def _analytics_query(cursor, scope: str, sp: dict) -> dict:
    """Recruitment analytics. When `scope` is set, every count is constrained to
    jobs in the selected company/branch by joining through to RECRUITMENT_JOBS j."""
    j_join_app = "JOIN RECRUITMENT_JOBS j ON j.JOB_ID = a.JOB_ID"
    j_join_off = ("JOIN RECRUITMENT_APPLICATIONS a ON a.APP_ID = o.APP_ID "
                  "JOIN RECRUITMENT_JOBS j ON j.JOB_ID = a.JOB_ID")

    # Open positions
    cursor.execute(f"SELECT COUNT(*) FROM RECRUITMENT_JOBS j WHERE j.STATUS = 'OPEN'{scope}", sp)
    open_jobs = int(cursor.fetchone()[0] or 0)

    # Applications by status
    cursor.execute(f"""
        SELECT a.STATUS, COUNT(*)
        FROM RECRUITMENT_APPLICATIONS a {j_join_app}
        WHERE 1=1{scope}
        GROUP BY a.STATUS
    """, sp)
    app_counts = {r[0]: int(r[1]) for r in cursor.fetchall()}

    # Total interviews
    cursor.execute(f"""
        SELECT COUNT(*)
        FROM RECRUITMENT_INTERVIEWS i
        JOIN RECRUITMENT_APPLICATIONS a ON a.APP_ID = i.APP_ID {j_join_app}
        WHERE 1=1{scope}
    """, sp)
    total_interviews = int(cursor.fetchone()[0] or 0)

    # Hires this month (ACCEPTED offers in current month)
    cursor.execute(f"""
        SELECT COUNT(*)
        FROM RECRUITMENT_OFFERS o {j_join_off}
        WHERE o.STATUS = 'ACCEPTED'
          AND TRUNC(o.OFFER_DATE, 'MM') = TRUNC(SYSDATE, 'MM'){scope}
    """, sp)
    hires_this_month = int(cursor.fetchone()[0] or 0)

    # Monthly hires (last 6 months)
    cursor.execute(f"""
        SELECT TO_CHAR(o.OFFER_DATE, 'MON YYYY') AS MONTH, COUNT(*) AS HIRES
        FROM RECRUITMENT_OFFERS o {j_join_off}
        WHERE o.STATUS = 'ACCEPTED'
          AND o.OFFER_DATE >= ADD_MONTHS(TRUNC(SYSDATE, 'MM'), -5){scope}
        GROUP BY TO_CHAR(o.OFFER_DATE, 'MON YYYY'), TRUNC(o.OFFER_DATE, 'MM')
        ORDER BY TRUNC(o.OFFER_DATE, 'MM')
    """, sp)
    monthly_hires = [{"month": r[0], "hires": int(r[1])} for r in cursor.fetchall()]

    # Avg time to hire (days from APP_DATE to OFFER ACCEPTED date)
    cursor.execute(f"""
        SELECT AVG(o.OFFER_DATE - a.APP_DATE)
        FROM RECRUITMENT_OFFERS o {j_join_off}
        WHERE o.STATUS = 'ACCEPTED'{scope}
    """, sp)
    row = cursor.fetchone()
    avg_time_to_hire = round(float(row[0]), 1) if row and row[0] else 0

    # Avg cost per hire (avg salary offered for ACCEPTED offers)
    cursor.execute(f"""
        SELECT AVG(o.SALARY_OFFERED)
        FROM RECRUITMENT_OFFERS o {j_join_off}
        WHERE o.STATUS = 'ACCEPTED'{scope}
    """, sp)
    row = cursor.fetchone()
    avg_cost_per_hire = round(float(row[0]), 0) if row and row[0] else 0

    return {
        "open_jobs": open_jobs,
        "total_applications": sum(app_counts.values()),
        "pending": app_counts.get("PENDING", 0),
        "shortlisted": app_counts.get("SHORTLISTED", 0),
        "rejected": app_counts.get("REJECTED", 0),
        "total_interviews": total_interviews,
        "hires_this_month": hires_this_month,
        "avg_time_to_hire_days": avg_time_to_hire,
        "avg_cost_per_hire": avg_cost_per_hire,
        "monthly_hires": monthly_hires,
    }
