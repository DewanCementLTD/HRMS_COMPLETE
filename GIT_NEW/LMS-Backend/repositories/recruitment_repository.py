"""Recruitment repository — CRUD on RECRUITMENT_* tables.

Optional company/branch scoping: if RECRUITMENT_JOBS has COMPC / BRNCH columns
(added via migration), jobs are stamped with and filtered by the admin's
company/branch. The code uses progressive fallback so it works unchanged when
those columns do not yet exist.

    -- Migration to enable per-company/branch recruitment:
    ALTER TABLE RECRUITMENT_JOBS ADD (COMPC NUMBER, BRNCH NUMBER);
"""

import re
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

        # Structured job fields used by the AI CV scoring (added idempotently,
        # same graceful-degradation pattern as COMPC/BRNCH). Must-have skills stay
        # in the existing SKILLS_REQ column; NICE_TO_HAVE_SKILLS is the new
        # secondary list. Salary/experience/education feed the evaluator + filters.
        for coldef in (
            "EMPLOYMENT_TYPE VARCHAR2(30)",
            "WORK_MODE VARCHAR2(60)",
            "NICE_TO_HAVE_SKILLS VARCHAR2(2000)",
            "MIN_EXPERIENCE_YEARS NUMBER",
            "EDUCATION_REQ VARCHAR2(300)",
            "SALARY_MIN NUMBER",
            "SALARY_MAX NUMBER",
        ):
            col = coldef.split()[0]
            try:
                cursor.execute(f"ALTER TABLE RECRUITMENT_JOBS ADD ({coldef})")
                print(f"[RECRUITMENT] Added column {col} to RECRUITMENT_JOBS")
            except Exception as e:
                if "ORA-01430" not in str(e):  # already exists → fine
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
        "skills_req": data.get("skills_req"),  # = must-have skills
        "created_by": created_by,
    }
    # Structured AI-scoring fields (new columns).
    ext = {
        "employment_type": data.get("employment_type"),
        "work_mode": data.get("work_mode"),
        "nice_to_have_skills": data.get("nice_to_have_skills"),
        "min_experience_years": _r_to_int(data.get("min_experience_years")),
        "education_req": data.get("education_req"),
        "salary_min": data.get("salary_min"),
        "salary_max": data.get("salary_max"),
    }
    ext_cols = ("EMPLOYMENT_TYPE, WORK_MODE, NICE_TO_HAVE_SKILLS, "
                "MIN_EXPERIENCE_YEARS, EDUCATION_REQ, SALARY_MIN, SALARY_MAX")
    ext_vals = (":employment_type, :work_mode, :nice_to_have_skills, "
                ":min_experience_years, :education_req, :salary_min, :salary_max")
    cval = _r_to_int(compc)
    bval = _r_to_int(brnch)
    # Try fullest insert first; fall back if newer columns don't exist (ORA-00904).
    attempts = []
    if cval is not None or bval is not None:
        attempts.append((
            f"""INSERT INTO RECRUITMENT_JOBS (
                JOB_ID, JOB_TITLE, DEPT_NO, OPEN_POSITIONS, JOB_DESC, SKILLS_REQ,
                {ext_cols}, STATUS, CREATED_BY, CREATED_AT, UPDATED_AT, COMPC, BRNCH
            ) VALUES (
                RECRUITMENT_JOBS_SEQ.NEXTVAL, :job_title, :dept_no, :open_positions,
                :job_desc, :skills_req, {ext_vals}, 'OPEN', :created_by, SYSDATE,
                SYSDATE, :compc, :brnch
            )""",
            {**base, **ext, "compc": cval, "brnch": bval},
        ))
    attempts.append((
        f"""INSERT INTO RECRUITMENT_JOBS (
            JOB_ID, JOB_TITLE, DEPT_NO, OPEN_POSITIONS, JOB_DESC, SKILLS_REQ,
            {ext_cols}, STATUS, CREATED_BY, CREATED_AT, UPDATED_AT
        ) VALUES (
            RECRUITMENT_JOBS_SEQ.NEXTVAL, :job_title, :dept_no, :open_positions,
            :job_desc, :skills_req, {ext_vals}, 'OPEN', :created_by, SYSDATE, SYSDATE
        )""",
        {**base, **ext},
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
                j.EMPLOYMENT_TYPE,
                j.WORK_MODE,
                j.NICE_TO_HAVE_SKILLS,
                j.MIN_EXPERIENCE_YEARS,
                j.EDUCATION_REQ,
                j.SALARY_MIN,
                j.SALARY_MAX,
                j.STATUS,
                j.CREATED_BY,
                TO_CHAR(j.CREATED_AT, 'YYYY-MM-DD') AS CREATED_AT
            FROM RECRUITMENT_JOBS j
            LEFT JOIN HR_DEPT d ON TO_CHAR(d.DEPT_NO) = TO_CHAR(j.DEPT_NO) AND TO_CHAR(d.COMPC) = TO_CHAR(j.COMPC)
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
    ensure_recruitment_company_columns()
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
                j.EMPLOYMENT_TYPE,
                j.WORK_MODE,
                j.NICE_TO_HAVE_SKILLS,
                j.MIN_EXPERIENCE_YEARS,
                j.EDUCATION_REQ,
                j.SALARY_MIN,
                j.SALARY_MAX,
                j.STATUS,
                j.CREATED_BY,
                TO_CHAR(j.CREATED_AT, 'YYYY-MM-DD') AS CREATED_AT
            FROM RECRUITMENT_JOBS j
            LEFT JOIN HR_DEPT d ON TO_CHAR(d.DEPT_NO) = TO_CHAR(j.DEPT_NO) AND TO_CHAR(d.COMPC) = TO_CHAR(j.COMPC)
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
        "employment_type": "EMPLOYMENT_TYPE",
        "work_mode": "WORK_MODE",
        "nice_to_have_skills": "NICE_TO_HAVE_SKILLS",
        "min_experience_years": "MIN_EXPERIENCE_YEARS",
        "education_req": "EDUCATION_REQ",
        "salary_min": "SALARY_MIN",
        "salary_max": "SALARY_MAX",
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
    # Talent-Pool flow: when a candidate_id is given, the application links to
    # the permanent candidate profile (name/contact copied from it).
    if data.get("candidate_id"):
        return apply_candidate_to_job(
            int(data["candidate_id"]), data.get("job_id"),
            source=data.get("source"), notes=data.get("notes"),
        )
    # Legacy quick-add (no talent-pool profile) — kept for old callers.
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
                a.CANDIDATE_ID,
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
                a.APP_ID, a.JOB_ID, j.JOB_TITLE, a.CANDIDATE_ID,
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

_interview_cols_ready = False


def ensure_interview_feedback_columns():
    """Idempotently add the structured interview-feedback columns (ratings,
    recommendation, feedback owner) used by the interview feedback form. Safe to
    call repeatedly; degrades gracefully without DDL rights."""
    global _interview_cols_ready
    if _interview_cols_ready:
        return
    conn = get_connection()
    cursor = conn.cursor()
    try:
        for coldef in (
            "TECHNICAL_RATING VARCHAR2(20)",
            "COMMUNICATION_RATING VARCHAR2(20)",
            "CULTURE_FIT_RATING VARCHAR2(20)",
            "RECOMMENDATION VARCHAR2(40)",   # Next round / Send offer / Reject
            "FEEDBACK_OWNER VARCHAR2(200)",
        ):
            col = coldef.split()[0]
            try:
                cursor.execute(f"ALTER TABLE RECRUITMENT_INTERVIEWS ADD ({coldef})")
                print(f"[RECRUITMENT] Added column {col} to RECRUITMENT_INTERVIEWS")
            except Exception as e:
                if "ORA-01430" not in str(e):  # already exists → fine
                    print(f"[RECRUITMENT] Could not add {col}: {str(e).splitlines()[0]}")
        _interview_cols_ready = True
    finally:
        cursor.close()
        conn.close()


def create_interview(data: dict) -> dict:
    ensure_interview_feedback_columns()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            INSERT INTO RECRUITMENT_INTERVIEWS (
                INTERVIEW_ID, APP_ID, INTERVIEW_DATE, INTERVIEW_TYPE,
                INTERVIEWER, FEEDBACK_OWNER, STATUS, CREATED_AT
            ) VALUES (
                RECRUITMENT_INTERVIEWS_SEQ.NEXTVAL, :app_id,
                TO_DATE(:interview_date, 'YYYY-MM-DD'),
                :interview_type, :interviewer, :feedback_owner, 'SCHEDULED', SYSDATE
            )
        """, {
            "app_id": data.get("app_id"),
            "interview_date": data.get("interview_date"),
            "interview_type": data.get("interview_type"),
            "interviewer": data.get("interviewer"),
            "feedback_owner": data.get("feedback_owner"),
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
    ensure_interview_feedback_columns()
    # LOCATION_OR_LINK/INTERVIEW_MODE (on RECRUITMENT_INTERVIEWS) and the
    # INTERVIEW_ASSIGNMENTS table (for start/end time) live in the panel-pool
    # DDL, not this module's — make sure they exist before the join below.
    try:
        from repositories.interview_panel_repository import ensure_interview_tables
        ensure_interview_tables()
    except Exception:
        pass
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
                i.FEEDBACK_OWNER,
                i.TECHNICAL_RATING,
                i.COMMUNICATION_RATING,
                i.CULTURE_FIT_RATING,
                i.RECOMMENDATION,
                i.STATUS,
                i.FEEDBACK,
                TO_CHAR(i.CREATED_AT, 'YYYY-MM-DD') AS CREATED_AT,
                ia.START_TIME,
                ia.END_TIME,
                i.LOCATION_OR_LINK,
                i.INTERVIEW_MODE
            FROM RECRUITMENT_INTERVIEWS i
            JOIN RECRUITMENT_APPLICATIONS a ON a.APP_ID = i.APP_ID
            JOIN RECRUITMENT_JOBS j ON j.JOB_ID = a.JOB_ID
            LEFT JOIN (
                SELECT INTERVIEW_ID, MIN(START_TIME) AS START_TIME, MAX(END_TIME) AS END_TIME
                FROM INTERVIEW_ASSIGNMENTS
                GROUP BY INTERVIEW_ID
            ) ia ON ia.INTERVIEW_ID = i.INTERVIEW_ID
            __WHERE__
            ORDER BY i.INTERVIEW_ID DESC
        """
    try:
        rows = _scoped_list(cursor, sql, conditions, params, compc, brnch)
        for r in rows:
            r["feedback"] = _lob(r.get("feedback"))
        return rows
    finally:
        cursor.close()
        conn.close()


def update_interview(interview_id: int, data: dict) -> dict:
    ensure_interview_feedback_columns()
    conn = get_connection()
    cursor = conn.cursor()
    field_map = {
        "status": "STATUS",
        "feedback": "FEEDBACK",
        "interviewer": "INTERVIEWER",
        "interview_type": "INTERVIEW_TYPE",
        "feedback_owner": "FEEDBACK_OWNER",
        "technical_rating": "TECHNICAL_RATING",
        "communication_rating": "COMMUNICATION_RATING",
        "culture_fit_rating": "CULTURE_FIT_RATING",
        "recommendation": "RECOMMENDATION",
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


# ------------------------------------------------------------------
# CANDIDATES — the permanent Talent Pool.
#
# One person = one RECRUITMENT_CANDIDATES row, never duplicated *within a
# company*. Child tables hold education / experience / skills. Applications
# link a candidate to a job via RECRUITMENT_APPLICATIONS.CANDIDATE_ID (legacy
# name/mobile/email columns are still filled from the profile).
#
# Scoping: each candidate is stamped with the creating admin's COMPC / BRNCH —
# company 1's pool is invisible to company 2. Like jobs, BRNCH NULL means
# company-wide (visible in every branch of that company).
# ------------------------------------------------------------------

_candidate_seqs_ready = False


def ensure_candidate_sequences():
    """Idempotently create sequences for the candidate tables (they were created
    without sequences) and add the COMPC/BRNCH scoping columns. Safe to call
    repeatedly; degrades gracefully without DDL rights."""
    global _candidate_seqs_ready
    if _candidate_seqs_ready:
        return
    conn = get_connection()
    cursor = conn.cursor()
    try:
        for seq, table, col in (
            ("RECRUITMENT_CANDIDATES_SEQ", "RECRUITMENT_CANDIDATES", "CANDIDATE_ID"),
            ("RECRUITMENT_CAND_EDU_SEQ", "RECRUITMENT_CANDIDATE_EDUCATION", "EDUCATION_ID"),
            ("RECRUITMENT_CAND_EXP_SEQ", "RECRUITMENT_CANDIDATE_EXPERIENCE", "EXPERIENCE_ID"),
            ("RECRUITMENT_CAND_SKILL_SEQ", "RECRUITMENT_CANDIDATE_SKILLS", "SKILL_ID"),
        ):
            try:
                cursor.execute(f"SELECT NVL(MAX({col}), 0) + 1 FROM {table}")
                start = int(cursor.fetchone()[0])
                cursor.execute(f"CREATE SEQUENCE {seq} START WITH {start} NOCACHE")
                print(f"[RECRUITMENT] Created sequence {seq} (start {start})")
            except Exception as e:
                # ORA-00955: name already used -> sequence exists, fine.
                if "ORA-00955" not in str(e):
                    print(f"[RECRUITMENT] Could not create {seq}: {str(e).splitlines()[0]}")

        # Company/branch scoping columns (mirrors RECRUITMENT_JOBS).
        for col in ("COMPC", "BRNCH"):
            try:
                cursor.execute(f"ALTER TABLE RECRUITMENT_CANDIDATES ADD ({col} NUMBER)")
                print(f"[RECRUITMENT] Added column {col} to RECRUITMENT_CANDIDATES")
            except Exception as e:
                if "ORA-01430" not in str(e):  # column already exists → fine
                    print(f"[RECRUITMENT] Could not add candidate {col}: {str(e).splitlines()[0]}")

        _candidate_seqs_ready = True
    finally:
        cursor.close()
        conn.close()


def _candidate_scope_filter(params: dict, compc=None, brnch=None, alias: str = "c") -> str:
    """Scope fragment for candidate queries. Company is strict; branch matches
    the selected branch(es) OR NULL (company-wide candidates stay visible in
    every branch of the company) — same semantics as jobs."""
    parts = []
    cnums = [n for n in (_r_to_int(x) for x in (compc if isinstance(compc, (list, tuple)) else [compc]))
             if n is not None]
    bnums = [n for n in (_r_to_int(x) for x in (brnch if isinstance(brnch, (list, tuple)) else [brnch]))
             if n is not None]
    if cnums:
        ph = ", ".join(f":cc{i}" for i in range(len(cnums)))
        parts.append(f"{alias}.COMPC IN ({ph})")
        for i, n in enumerate(cnums):
            params[f"cc{i}"] = n
    if bnums:
        ph = ", ".join(f":cb{i}" for i in range(len(bnums)))
        parts.append(f"({alias}.BRNCH IN ({ph}) OR {alias}.BRNCH IS NULL)")
        for i, n in enumerate(bnums):
            params[f"cb{i}"] = n
    return (" AND " + " AND ".join(parts)) if parts else ""


def candidate_in_scope(candidate_id: int, compc=None, brnch=None) -> bool:
    """True when the candidate is visible to the given company/branch lists
    (used to stop cross-company access via direct id). Empty lists = no
    restriction (super admin)."""
    cnums = [n for n in (_r_to_int(x) for x in (compc or [])) if n is not None]
    bnums = [n for n in (_r_to_int(x) for x in (brnch or [])) if n is not None]
    if not cnums and not bnums:
        return True
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT COMPC, BRNCH FROM RECRUITMENT_CANDIDATES WHERE CANDIDATE_ID = :cid
        """, {"cid": candidate_id})
        row = cursor.fetchone()
        if not row:
            return False
        c, b = (_r_to_int(row[0]), _r_to_int(row[1]))
        if cnums and c is not None and c not in cnums:
            return False
        if bnums and b is not None and b not in bnums:
            return False
        return True
    except Exception as e:
        if "ORA-00904" in str(e):  # scoping columns absent → unscoped
            return True
        raise
    finally:
        cursor.close()
        conn.close()


def _lob(v):
    """Read an Oracle LOB to str (CLOB columns come back as LOB objects)."""
    return v.read() if hasattr(v, "read") else v


def _insert_candidate_children(cursor, candidate_id: int, data: dict):
    """Insert education / experience / skills child rows for a candidate."""
    for edu in (data.get("education") or []):
        if not any((edu.get("institution"), edu.get("degree"))):
            continue
        cursor.execute("""
            INSERT INTO RECRUITMENT_CANDIDATE_EDUCATION
                (EDUCATION_ID, CANDIDATE_ID, INSTITUTION, DEGREE, GRADUATION_YEAR)
            VALUES (RECRUITMENT_CAND_EDU_SEQ.NEXTVAL, :cid, :inst, :deg, :yr)
        """, {"cid": candidate_id, "inst": (edu.get("institution") or "")[:300] or None,
              "deg": (edu.get("degree") or "")[:300] or None,
              "yr": (str(edu.get("graduation_year") or ""))[:20] or None})
    for exp in (data.get("experience") or []):
        if not any((exp.get("company"), exp.get("role"))):
            continue
        cursor.execute("""
            INSERT INTO RECRUITMENT_CANDIDATE_EXPERIENCE
                (EXPERIENCE_ID, CANDIDATE_ID, COMPANY, ROLE, DURATION, DESCRIPTION)
            VALUES (RECRUITMENT_CAND_EXP_SEQ.NEXTVAL, :cid, :co, :role, :dur, :descr)
        """, {"cid": candidate_id, "co": (exp.get("company") or "")[:300] or None,
              "role": (exp.get("role") or "")[:200] or None,
              "dur": (exp.get("duration") or "")[:100] or None,
              "descr": exp.get("description") or None})
    for skill in (data.get("skills") or []):
        s = str(skill or "").strip()[:100]
        if not s:
            continue
        cursor.execute("""
            INSERT INTO RECRUITMENT_CANDIDATE_SKILLS (SKILL_ID, CANDIDATE_ID, SKILL_NAME)
            VALUES (RECRUITMENT_CAND_SKILL_SEQ.NEXTVAL, :cid, :s)
        """, {"cid": candidate_id, "s": s})


def find_duplicate_candidate(cursor, email: str = None, mobile: str = None,
                             exclude_id: int = None, compc=None):
    """Return (candidate_id, name) of an existing candidate with the same email
    or mobile, else None. Deduped WITHIN a company — the same person may exist
    in another company's pool."""
    conds, params = [], {}
    if email and email.strip():
        conds.append("LOWER(TRIM(EMAIL)) = :em")
        params["em"] = email.strip().lower()
    if mobile and mobile.strip():
        conds.append("TRIM(MOBILE) = :mb")
        params["mb"] = mobile.strip()
    if not conds:
        return None
    sql = ("SELECT CANDIDATE_ID, CANDIDATE_NAME FROM RECRUITMENT_CANDIDATES "
           "WHERE (" + " OR ".join(conds) + ")")
    cval = _r_to_int(compc)
    if cval is not None:
        sql += " AND (COMPC = :dupc OR COMPC IS NULL)"
        params["dupc"] = cval
    if exclude_id is not None:
        sql += " AND CANDIDATE_ID != :xid"
        params["xid"] = exclude_id
    cursor.execute(sql + " FETCH FIRST 1 ROWS ONLY", params)
    return cursor.fetchone()


def create_candidate(data: dict, compc=None, brnch=None) -> dict:
    """Insert a candidate stamped with the creating admin's company/branch.
    brnch None = company-wide (visible in every branch of that company)."""
    ensure_candidate_sequences()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cval = _r_to_int(compc)
        bval = _r_to_int(brnch)
        dup = find_duplicate_candidate(cursor, data.get("email"), data.get("mobile"),
                                       compc=cval)
        if dup:
            return {"status": "duplicate", "candidate_id": int(dup[0]),
                    "message": f"Candidate already exists: {dup[1]} (#{int(dup[0])}). "
                               f"Update their profile instead of creating a duplicate."}
        out = cursor.var(int)
        cursor.execute("""
            INSERT INTO RECRUITMENT_CANDIDATES (
                CANDIDATE_ID, CANDIDATE_NAME, EMAIL, MOBILE, LOCATION,
                PREFERRED_JOB_TITLE, PROFILE_SUMMARY, COMPC, BRNCH,
                CREATED_AT, UPDATED_AT
            ) VALUES (
                RECRUITMENT_CANDIDATES_SEQ.NEXTVAL, :name, :email, :mobile, :loc,
                :pref, :summary, :compc, :brnch, SYSDATE, SYSDATE
            ) RETURNING CANDIDATE_ID INTO :out_id
        """, {
            "name": (data.get("candidate_name") or "").strip()[:200],
            "email": (data.get("email") or "").strip()[:200] or None,
            "mobile": (data.get("mobile") or "").strip()[:30] or None,
            "loc": (data.get("location") or "").strip()[:200] or None,
            "pref": (data.get("preferred_job_title") or "").strip()[:200] or None,
            "summary": data.get("profile_summary") or None,
            "compc": cval, "brnch": bval,
            "out_id": out,
        })
        candidate_id = int(out.getvalue()[0])
        _insert_candidate_children(cursor, candidate_id, data)
        conn.commit()
        return {"status": "success", "candidate_id": candidate_id}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


def list_candidates(search: str = None, compc=None, brnch=None) -> list:
    ensure_candidate_sequences()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        params = {}
        conds = []
        if search and search.strip():
            params["q"] = f"%{search.strip().lower()}%"
            conds.append("""(
                    LOWER(c.CANDIDATE_NAME) LIKE :q
                   OR LOWER(NVL(c.EMAIL, ' ')) LIKE :q
                   OR NVL(c.MOBILE, ' ') LIKE :q
                   OR LOWER(NVL(c.LOCATION, ' ')) LIKE :q
                   OR LOWER(NVL(c.PREFERRED_JOB_TITLE, ' ')) LIKE :q
                   OR EXISTS (SELECT 1 FROM RECRUITMENT_CANDIDATE_SKILLS s
                              WHERE s.CANDIDATE_ID = c.CANDIDATE_ID
                                AND LOWER(s.SKILL_NAME) LIKE :q))""")
        scope = _candidate_scope_filter(params, compc, brnch)
        where = ("WHERE " + " AND ".join(conds)) if conds else ""
        if scope:
            where = (where + scope) if where else ("WHERE 1=1" + scope)

        def _run(w, p):
            cursor.execute(f"""
                SELECT
                    c.CANDIDATE_ID,
                    c.CANDIDATE_NAME,
                    c.EMAIL,
                    c.MOBILE,
                    c.LOCATION,
                    c.PREFERRED_JOB_TITLE,
                    c.CV_FILE_NAME,
                    TO_CHAR(c.CREATED_AT, 'YYYY-MM-DD') AS CREATED_AT,
                    (SELECT COUNT(*) FROM RECRUITMENT_APPLICATIONS a
                     WHERE a.CANDIDATE_ID = c.CANDIDATE_ID)          AS APPLICATIONS,
                    (SELECT LISTAGG(s.SKILL_NAME, ', ') WITHIN GROUP (ORDER BY s.SKILL_ID)
                     FROM RECRUITMENT_CANDIDATE_SKILLS s
                     WHERE s.CANDIDATE_ID = c.CANDIDATE_ID)          AS SKILLS
                FROM RECRUITMENT_CANDIDATES c
                {w}
                ORDER BY c.CANDIDATE_ID DESC
                FETCH FIRST 500 ROWS ONLY
            """, p)
            rows = cursor.fetchall()
            cols = [x[0].lower() for x in cursor.description]
            return [dict(zip(cols, r)) for r in rows]

        try:
            return _run(where, params)
        except Exception as e:
            # COMPC/BRNCH columns absent (no DDL rights) → list unscoped.
            if "ORA-00904" not in str(e) or not scope:
                raise
            print(f"[RECRUITMENT] candidate COMPC/BRNCH absent, listing unscoped: {e}")
            unscoped_params = {k: v for k, v in params.items() if not k.startswith(("cc", "cb"))}
            unscoped_where = ("WHERE " + " AND ".join(conds)) if conds else ""
            return _run(unscoped_where, unscoped_params)
    finally:
        cursor.close()
        conn.close()


def get_candidate(candidate_id: int) -> dict | None:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT CANDIDATE_ID, CANDIDATE_NAME, EMAIL, MOBILE, LOCATION,
                   PREFERRED_JOB_TITLE, CV_FILE_NAME, CV_FILE_PATH, PROFILE_SUMMARY,
                   COMPC, BRNCH,
                   TO_CHAR(CREATED_AT, 'YYYY-MM-DD') AS CREATED_AT,
                   TO_CHAR(UPDATED_AT, 'YYYY-MM-DD') AS UPDATED_AT
            FROM RECRUITMENT_CANDIDATES WHERE CANDIDATE_ID = :cid
        """, {"cid": candidate_id})
        row = cursor.fetchone()
        if not row:
            return None
        cols = [x[0].lower() for x in cursor.description]
        cand = dict(zip(cols, row))
        cand["profile_summary"] = _lob(cand.get("profile_summary"))

        cursor.execute("""
            SELECT EDUCATION_ID, INSTITUTION, DEGREE, GRADUATION_YEAR
            FROM RECRUITMENT_CANDIDATE_EDUCATION
            WHERE CANDIDATE_ID = :cid ORDER BY EDUCATION_ID
        """, {"cid": candidate_id})
        c = [x[0].lower() for x in cursor.description]
        cand["education"] = [dict(zip(c, r)) for r in cursor.fetchall()]

        cursor.execute("""
            SELECT EXPERIENCE_ID, COMPANY, ROLE, DURATION, DESCRIPTION
            FROM RECRUITMENT_CANDIDATE_EXPERIENCE
            WHERE CANDIDATE_ID = :cid ORDER BY EXPERIENCE_ID
        """, {"cid": candidate_id})
        c = [x[0].lower() for x in cursor.description]
        cand["experience"] = [
            {**dict(zip(c, r)), "description": _lob(r[4])} for r in cursor.fetchall()
        ]

        cursor.execute("""
            SELECT SKILL_NAME FROM RECRUITMENT_CANDIDATE_SKILLS
            WHERE CANDIDATE_ID = :cid ORDER BY SKILL_ID
        """, {"cid": candidate_id})
        cand["skills"] = [r[0] for r in cursor.fetchall() if r[0]]

        cursor.execute("""
            SELECT a.APP_ID, a.JOB_ID, j.JOB_TITLE, a.STATUS,
                   TO_CHAR(a.APP_DATE, 'YYYY-MM-DD') AS APP_DATE,
                   (SELECT e.OVERALL_SCORE FROM RECRUITMENT_AI_EVALUATIONS e
                    WHERE e.APPLICATION_ID = a.APP_ID
                    ORDER BY e.EVALUATION_ID DESC FETCH FIRST 1 ROWS ONLY) AS AI_OVERALL_SCORE
            FROM RECRUITMENT_APPLICATIONS a
            JOIN RECRUITMENT_JOBS j ON j.JOB_ID = a.JOB_ID
            WHERE a.CANDIDATE_ID = :cid
            ORDER BY a.APP_ID DESC
        """, {"cid": candidate_id})
        c = [x[0].lower() for x in cursor.description]
        cand["applications"] = [
            {**dict(zip(c, r)), "ai_overall_score": _r_to_int(dict(zip(c, r)).get("ai_overall_score"))}
            for r in cursor.fetchall()
        ]

        return cand
    finally:
        cursor.close()
        conn.close()


def update_candidate(candidate_id: int, data: dict) -> dict:
    """Update profile fields; when education / experience / skills lists are
    provided they REPLACE the existing child rows (the profile is the single
    source of truth — re-uploads update the same person, never duplicate)."""
    ensure_candidate_sequences()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # Dedupe within the candidate's own company only.
        own_compc = None
        try:
            cursor.execute("SELECT COMPC FROM RECRUITMENT_CANDIDATES WHERE CANDIDATE_ID = :cid",
                           {"cid": candidate_id})
            r = cursor.fetchone()
            own_compc = r[0] if r else None
        except Exception:
            pass
        dup = find_duplicate_candidate(cursor, data.get("email"), data.get("mobile"),
                                       exclude_id=candidate_id, compc=own_compc)
        if dup:
            return {"status": "error",
                    "message": f"Another candidate already uses this email/mobile: {dup[1]} (#{int(dup[0])})"}
        field_map = {
            "candidate_name": "CANDIDATE_NAME", "email": "EMAIL", "mobile": "MOBILE",
            "location": "LOCATION", "preferred_job_title": "PREFERRED_JOB_TITLE",
            "profile_summary": "PROFILE_SUMMARY",
        }
        sets = ["UPDATED_AT = SYSDATE"]
        params = {"cid": candidate_id}
        for key, col in field_map.items():
            if key in data and data[key] is not None:
                sets.append(f"{col} = :{key}")
                params[key] = data[key]
        cursor.execute(
            f"UPDATE RECRUITMENT_CANDIDATES SET {', '.join(sets)} WHERE CANDIDATE_ID = :cid",
            params,
        )
        if cursor.rowcount == 0:
            conn.rollback()
            return {"status": "error", "message": "Candidate not found"}

        # Replace child lists when provided (None = leave untouched).
        replace = {}
        if data.get("education") is not None:
            cursor.execute("DELETE FROM RECRUITMENT_CANDIDATE_EDUCATION WHERE CANDIDATE_ID = :cid",
                           {"cid": candidate_id})
            replace["education"] = data["education"]
        if data.get("experience") is not None:
            cursor.execute("DELETE FROM RECRUITMENT_CANDIDATE_EXPERIENCE WHERE CANDIDATE_ID = :cid",
                           {"cid": candidate_id})
            replace["experience"] = data["experience"]
        if data.get("skills") is not None:
            cursor.execute("DELETE FROM RECRUITMENT_CANDIDATE_SKILLS WHERE CANDIDATE_ID = :cid",
                           {"cid": candidate_id})
            replace["skills"] = data["skills"]
        if replace:
            _insert_candidate_children(cursor, candidate_id, replace)

        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


def candidate_cv_target(candidate_id: int, ext: str) -> dict | None:
    """Where a candidate's CV file should be written, following the same
    company/branch folder convention as employee documents:
        EMP_DOCS/<CompanyName>/<BranchName>/RECRUITMENT_CVS/cand_{id}.{ext}
    Branch folder is omitted for company-wide candidates (BRNCH NULL); both are
    omitted for legacy unscoped candidates. Returns
    {abs_dir, abs_path, rel_path, old_abs_path} or None if candidate missing."""
    import os
    from repositories.document_repository import DOCS_BASE, _safe_name

    conn = get_connection()
    cursor = conn.cursor()
    try:
        try:
            cursor.execute("""
                SELECT COMPC, BRNCH, CV_FILE_PATH FROM RECRUITMENT_CANDIDATES
                WHERE CANDIDATE_ID = :cid
            """, {"cid": candidate_id})
            row = cursor.fetchone()
        except Exception as e:
            if "ORA-00904" not in str(e):
                raise
            cursor.execute("""
                SELECT NULL, NULL, CV_FILE_PATH FROM RECRUITMENT_CANDIDATES
                WHERE CANDIDATE_ID = :cid
            """, {"cid": candidate_id})
            row = cursor.fetchone()
        if not row:
            return None
        compc, brnch, old_rel = _r_to_int(row[0]), _r_to_int(row[1]), (row[2] or "").strip()

        parts = ["EMP_DOCS"]
        if compc is not None:
            company_name = None
            try:
                cursor.execute("SELECT UNIT_NAME FROM UNIT_MST WHERE UNIT_ID = :u", {"u": compc})
                r = cursor.fetchone()
                company_name = r[0] if r else None
            except Exception:
                pass
            parts.append(_safe_name(company_name, f"Comp{compc}"))
            if brnch is not None:
                branch_name = None
                try:
                    cursor.execute("SELECT DESCR FROM COM_LOCATION WHERE LCODE = :l",
                                   {"l": str(brnch)})
                    r = cursor.fetchone()
                    branch_name = r[0] if r else None
                except Exception:
                    pass
                parts.append(_safe_name(branch_name, f"branch{brnch}"))
        parts.append("RECRUITMENT_CVS")

        fname = f"cand_{candidate_id}.{(ext or 'bin').lstrip('.').lower()}"
        rel_dir = os.path.join(*parts)
        rel_path = os.path.join(rel_dir, fname)
        abs_dir = os.path.join(DOCS_BASE, rel_dir)
        old_abs = None
        if old_rel:
            old_abs = old_rel if os.path.isabs(old_rel) else os.path.join(DOCS_BASE, old_rel)
        return {
            "abs_dir": abs_dir,
            "abs_path": os.path.join(DOCS_BASE, rel_path),
            "rel_path": rel_path,
            "old_abs_path": old_abs,
        }
    finally:
        cursor.close()
        conn.close()


def set_candidate_cv(candidate_id: int, file_name: str, rel_path: str) -> dict:
    """Record the (re-)uploaded CV on the candidate. Replaces the previous CV
    reference — one current resume per person."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            UPDATE RECRUITMENT_CANDIDATES
            SET CV_FILE_NAME = :fn, CV_FILE_PATH = :fp, UPDATED_AT = SYSDATE
            WHERE CANDIDATE_ID = :cid
        """, {"fn": (file_name or "")[:255] or None, "fp": (rel_path or "")[:1000] or None,
              "cid": candidate_id})
        if cursor.rowcount == 0:
            conn.rollback()
            return {"status": "error", "message": "Candidate not found"}
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


def get_candidate_cv_path(candidate_id: int):
    """Return (cv_file_name, cv_file_path) or None."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT CV_FILE_NAME, CV_FILE_PATH FROM RECRUITMENT_CANDIDATES
            WHERE CANDIDATE_ID = :cid
        """, {"cid": candidate_id})
        return cursor.fetchone()
    finally:
        cursor.close()
        conn.close()


def apply_candidate_to_job(candidate_id: int, job_id: int,
                           source: str = None, notes: str = None) -> dict:
    """Create an application linking an existing Talent Pool candidate to a job.
    Legacy name/mobile/email columns are filled from the profile. One candidate
    can apply to a job only once."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT CANDIDATE_NAME, MOBILE, EMAIL FROM RECRUITMENT_CANDIDATES
            WHERE CANDIDATE_ID = :cid
        """, {"cid": candidate_id})
        cand = cursor.fetchone()
        if not cand:
            return {"status": "error", "message": "Candidate not found"}

        cursor.execute("""
            SELECT COUNT(*) FROM RECRUITMENT_APPLICATIONS
            WHERE CANDIDATE_ID = :cid AND JOB_ID = :jid
        """, {"cid": candidate_id, "jid": job_id})
        if int(cursor.fetchone()[0]) > 0:
            return {"status": "error", "message": "This candidate has already applied to this job"}

        cursor.execute("""
            INSERT INTO RECRUITMENT_APPLICATIONS (
                APP_ID, JOB_ID, CANDIDATE_ID, CANDIDATE_NAME, MOBILE, EMAIL,
                SOURCE, APP_DATE, STATUS, NOTES, CREATED_AT
            ) VALUES (
                RECRUITMENT_APPS_SEQ.NEXTVAL, :jid, :cid, :name, :mobile, :email,
                :source, SYSDATE, 'PENDING', :notes, SYSDATE
            )
        """, {"jid": job_id, "cid": candidate_id, "name": cand[0],
              "mobile": cand[1], "email": cand[2],
              "source": source, "notes": notes})
        conn.commit()
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


# ==================================================================
# AI EVALUATIONS - the CV pipeline's DB-backed persistence.
#
# The watcher (AI/cv_pipeline.py) and the API both call persist_cv_evaluation()
# so a CV lands as: candidate (permanent, deduped) -> application (candidate x
# job) -> evaluation (scores) -> strengths / weaknesses. Everything for one CV
# commits in a single transaction; nothing here imports FastAPI, so the watcher
# process can use it directly.
# ==================================================================

_ai_eval_seqs_ready = False


def ensure_ai_eval_sequences():
    """Idempotently create the sequences for the AI-evaluation tables (they were
    created without identity/sequences). Safe to call repeatedly; degrades
    gracefully without DDL rights (an insert would then fail and the pipeline
    records a .dberror.json for replay)."""
    global _ai_eval_seqs_ready
    if _ai_eval_seqs_ready:
        return
    conn = get_connection()
    cursor = conn.cursor()
    try:
        for seq, table, col in (
            ("RECRUITMENT_AI_EVAL_SEQ", "RECRUITMENT_AI_EVALUATIONS", "EVALUATION_ID"),
            ("RECRUITMENT_AI_STRENGTH_SEQ", "RECRUITMENT_AI_STRENGTHS", "STRENGTH_ID"),
            ("RECRUITMENT_AI_WEAKNESS_SEQ", "RECRUITMENT_AI_WEAKNESSES", "WEAKNESS_ID"),
        ):
            try:
                cursor.execute(f"SELECT NVL(MAX({col}), 0) + 1 FROM {table}")
                start = int(cursor.fetchone()[0])
                cursor.execute(f"CREATE SEQUENCE {seq} START WITH {start} NOCACHE")
                print(f"[RECRUITMENT] Created sequence {seq} (start {start})")
            except Exception as e:
                if "ORA-00955" not in str(e):  # name already used -> exists, fine
                    print(f"[RECRUITMENT] Could not create {seq}: {str(e).splitlines()[0]}")
        _ai_eval_seqs_ready = True
    finally:
        cursor.close()
        conn.close()


def _get_job_scope(cursor, job_id: int):
    """Return (job_title, job_desc, skills_req, compc, brnch) for a job, or None.
    COMPC/BRNCH may be absent on older schemas -> returned as None."""
    try:
        cursor.execute("""
            SELECT JOB_TITLE, JOB_DESC, SKILLS_REQ, COMPC, BRNCH
            FROM RECRUITMENT_JOBS WHERE JOB_ID = :jid
        """, {"jid": job_id})
        row = cursor.fetchone()
        if not row:
            return None
        return (_lob(row[0]), _lob(row[1]), _lob(row[2]), _r_to_int(row[3]), _r_to_int(row[4]))
    except Exception as e:
        if "ORA-00904" not in str(e):
            raise
        cursor.execute("""
            SELECT JOB_TITLE, JOB_DESC, SKILLS_REQ FROM RECRUITMENT_JOBS WHERE JOB_ID = :jid
        """, {"jid": job_id})
        row = cursor.fetchone()
        if not row:
            return None
        return (_lob(row[0]), _lob(row[1]), _lob(row[2]), None, None)


def _upsert_candidate_tx(cursor, metrics: dict, compc, brnch,
                         cv_file_name: str = None, cv_file_path: str = None) -> tuple:
    """Insert or update a candidate from extracted CV metrics, all on the caller's
    cursor (no commit). Matches an existing candidate by email -> mobile within the
    same company; on a match the profile + CV + child rows are refreshed (re-upload
    never duplicates a person). Returns (candidate_id, created_bool)."""
    contact = metrics.get("contact_info") or {}
    name = (contact.get("name") or "Unknown").strip()[:200] or "Unknown"
    email = (contact.get("email") or "").strip()[:200] or None
    mobile = (contact.get("phone") or "").strip()[:30] or None
    location = (contact.get("location") or "").strip()[:200] or None
    pref = (metrics.get("preferred_job_title") or "").strip()[:200] or None
    summary = metrics.get("profile_summary")
    children = {
        "education": metrics.get("education") or [],
        "experience": metrics.get("experience") or [],
        "skills": metrics.get("skills") or [],
    }

    dup = find_duplicate_candidate(cursor, email, mobile, compc=compc)
    if dup:
        candidate_id = int(dup[0])
        # Re-upload: refresh profile + CV pointer, keep name if the new one is blank.
        cursor.execute("""
            UPDATE RECRUITMENT_CANDIDATES SET
                CANDIDATE_NAME = NVL(:name, CANDIDATE_NAME),
                EMAIL = NVL(:email, EMAIL),
                MOBILE = NVL(:mobile, MOBILE),
                LOCATION = NVL(:loc, LOCATION),
                PREFERRED_JOB_TITLE = NVL(:pref, PREFERRED_JOB_TITLE),
                PROFILE_SUMMARY = NVL(:summary, PROFILE_SUMMARY),
                CV_FILE_NAME = NVL(:cvname, CV_FILE_NAME),
                CV_FILE_PATH = NVL(:cvpath, CV_FILE_PATH),
                UPDATED_AT = SYSDATE
            WHERE CANDIDATE_ID = :cid
        """, {"name": name, "email": email, "mobile": mobile, "loc": location,
              "pref": pref, "summary": summary,
              "cvname": (cv_file_name or None), "cvpath": (cv_file_path or None),
              "cid": candidate_id})
        # Replace child rows from the fresh extraction (profile = single truth).
        cursor.execute("DELETE FROM RECRUITMENT_CANDIDATE_EDUCATION WHERE CANDIDATE_ID = :cid", {"cid": candidate_id})
        cursor.execute("DELETE FROM RECRUITMENT_CANDIDATE_EXPERIENCE WHERE CANDIDATE_ID = :cid", {"cid": candidate_id})
        cursor.execute("DELETE FROM RECRUITMENT_CANDIDATE_SKILLS WHERE CANDIDATE_ID = :cid", {"cid": candidate_id})
        _insert_candidate_children(cursor, candidate_id, children)
        return candidate_id, False

    out = cursor.var(int)
    cursor.execute("""
        INSERT INTO RECRUITMENT_CANDIDATES (
            CANDIDATE_ID, CANDIDATE_NAME, EMAIL, MOBILE, LOCATION,
            PREFERRED_JOB_TITLE, PROFILE_SUMMARY, CV_FILE_NAME, CV_FILE_PATH,
            COMPC, BRNCH, CREATED_AT, UPDATED_AT
        ) VALUES (
            RECRUITMENT_CANDIDATES_SEQ.NEXTVAL, :name, :email, :mobile, :loc,
            :pref, :summary, :cvname, :cvpath, :compc, :brnch, SYSDATE, SYSDATE
        ) RETURNING CANDIDATE_ID INTO :out_id
    """, {"name": name, "email": email, "mobile": mobile, "loc": location,
          "pref": pref, "summary": summary,
          "cvname": (cv_file_name or None), "cvpath": (cv_file_path or None),
          "compc": _r_to_int(compc), "brnch": _r_to_int(brnch), "out_id": out})
    candidate_id = int(out.getvalue()[0])
    _insert_candidate_children(cursor, candidate_id, children)
    return candidate_id, True


def _find_or_create_application_tx(cursor, candidate_id: int, job_id: int,
                                   name: str, mobile: str, email: str,
                                   source: str = None) -> tuple:
    """Return (app_id, created_bool). Reuses the candidate's existing application
    for this job if there is one (a re-uploaded CV stores a fresh evaluation on
    the SAME application), else inserts a new PENDING application."""
    cursor.execute("""
        SELECT APP_ID FROM RECRUITMENT_APPLICATIONS
        WHERE CANDIDATE_ID = :cid AND JOB_ID = :jid
        ORDER BY APP_ID DESC FETCH FIRST 1 ROWS ONLY
    """, {"cid": candidate_id, "jid": job_id})
    row = cursor.fetchone()
    if row:
        return int(row[0]), False

    out = cursor.var(int)
    cursor.execute("""
        INSERT INTO RECRUITMENT_APPLICATIONS (
            APP_ID, JOB_ID, CANDIDATE_ID, CANDIDATE_NAME, MOBILE, EMAIL,
            SOURCE, APP_DATE, STATUS, CREATED_AT
        ) VALUES (
            RECRUITMENT_APPS_SEQ.NEXTVAL, :jid, :cid, :name, :mobile, :email,
            :source, SYSDATE, 'PENDING', SYSDATE
        ) RETURNING APP_ID INTO :out_id
    """, {"jid": job_id, "cid": candidate_id,
          "name": (name or "Unknown")[:200], "mobile": (mobile or None),
          "email": (email or None), "source": (source or "AI CV Upload"), "out_id": out})
    return int(out.getvalue()[0]), True


def _store_evaluation_tx(cursor, application_id: int, evaluation: dict,
                         stats: dict, total_seconds=None, processed_at=None) -> int:
    """Insert one AI evaluation for an application plus its strength/weakness
    child rows (on the caller's cursor, no commit). Returns the evaluation id."""
    out = cursor.var(int)
    params = {
        "app_id": application_id,
        "compat": _r_to_int(evaluation.get("compatibility")),
        "tech": _r_to_int(evaluation.get("technical_match")),
        "exp": _r_to_int(evaluation.get("experience_match")),
        "overall": _r_to_int(evaluation.get("overall_score")),
        "reco": evaluation.get("recommendation") or None,
        "summary": evaluation.get("summary") or None,
        "model": (stats.get("model") or "")[:100] or None,
        "ptok": _r_to_int(stats.get("prompt_tokens")),
        "otok": _r_to_int(stats.get("output_tokens")),
        "ttok": _r_to_int(stats.get("total_tokens")),
        "tsec": float(total_seconds) if total_seconds is not None else None,
        "lsec": float(stats["llm_seconds"]) if stats.get("llm_seconds") is not None else None,
        "pat": processed_at,
    }
    cursor.execute("""
        INSERT INTO RECRUITMENT_AI_EVALUATIONS (
            EVALUATION_ID, APPLICATION_ID, COMPATIBILITY, TECHNICAL_MATCH,
            EXPERIENCE_MATCH, OVERALL_SCORE, RECOMMENDATION, SUMMARY, MODEL_NAME,
            PROMPT_TOKENS, OUTPUT_TOKENS, TOTAL_TOKENS, TOTAL_SECONDS, LLM_SECONDS,
            PROCESSED_AT
        ) VALUES (
            RECRUITMENT_AI_EVAL_SEQ.NEXTVAL, :app_id, :compat, :tech, :exp, :overall,
            :reco, :summary, :model, :ptok, :otok, :ttok, :tsec, :lsec,
            NVL(TO_DATE(:pat, 'YYYY-MM-DD"T"HH24:MI:SS'), SYSDATE)
        ) RETURNING EVALUATION_ID INTO :out_id
    """, {**params, "out_id": out})
    evaluation_id = int(out.getvalue()[0])

    for s in (evaluation.get("strengths") or []):
        text = str(s or "").strip()
        if not text:
            continue
        cursor.execute("""
            INSERT INTO RECRUITMENT_AI_STRENGTHS (STRENGTH_ID, EVALUATION_ID, STRENGTH)
            VALUES (RECRUITMENT_AI_STRENGTH_SEQ.NEXTVAL, :eid, :t)
        """, {"eid": evaluation_id, "t": text})
    for w in (evaluation.get("weaknesses") or []):
        text = str(w or "").strip()
        if not text:
            continue
        cursor.execute("""
            INSERT INTO RECRUITMENT_AI_WEAKNESSES (WEAKNESS_ID, EVALUATION_ID, WEAKNESS)
            VALUES (RECRUITMENT_AI_WEAKNESS_SEQ.NEXTVAL, :eid, :t)
        """, {"eid": evaluation_id, "t": text})
    return evaluation_id


def persist_cv_evaluation(company_id, job_id, assessment: dict, stats: dict,
                          total_seconds=None, processed_at=None,
                          cv_file_name: str = None, cv_file_path: str = None) -> dict:
    """Persist one finished CV evaluation as candidate -> application -> evaluation
    (+ strengths/weaknesses) in ONE transaction. Called by the watcher pipeline
    after it has archived the PDF and written the Eval JSON, so a DB failure here
    never loses work -- the caller records a .dberror.json for replay.

    `job_id` is the numeric RECRUITMENT_JOBS.JOB_ID (the watcher derives it from
    the folder name's digits). The candidate is stamped with the JOB's company /
    branch so the pool scoping stays consistent with the job.

    Returns {status, candidate_id, application_id, evaluation_id, candidate_created,
    application_created} or {status: 'error', message}.
    """
    ensure_candidate_sequences()
    ensure_ai_eval_sequences()
    metrics = assessment.get("metrics") or {}
    evaluation = assessment.get("evaluation") or {}
    # The extractor/evaluator has no candidate-level summary field, so seed the
    # profile summary from the evaluation summary (best available blurb) when the
    # extraction didn't supply one — keeps RECRUITMENT_CANDIDATES.PROFILE_SUMMARY
    # populated as the Talent-Pool design intends.
    if not metrics.get("profile_summary") and evaluation.get("summary"):
        metrics = {**metrics, "profile_summary": evaluation["summary"]}

    conn = get_connection()
    cursor = conn.cursor()
    try:
        job = _get_job_scope(cursor, int(job_id))
        if job is None:
            return {"status": "error",
                    "message": f"Job {job_id} not found in RECRUITMENT_JOBS"}
        _, _, _, job_compc, job_brnch = job
        # Fall back to the company folder id when the job carries no COMPC.
        compc = job_compc if job_compc is not None else _r_to_int(company_id)

        candidate_id, cand_created = _upsert_candidate_tx(
            cursor, metrics, compc, job_brnch, cv_file_name, cv_file_path)

        contact = metrics.get("contact_info") or {}
        app_id, app_created = _find_or_create_application_tx(
            cursor, candidate_id, int(job_id),
            name=(contact.get("name") or "Unknown"),
            mobile=(contact.get("phone") or None),
            email=(contact.get("email") or None),
            source="AI CV Upload")

        evaluation_id = _store_evaluation_tx(
            cursor, app_id, evaluation, stats, total_seconds, processed_at)

        conn.commit()
        return {"status": "success", "candidate_id": candidate_id,
                "application_id": app_id, "evaluation_id": evaluation_id,
                "candidate_created": cand_created, "application_created": app_created}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


def get_application_evaluation(app_id: int):
    """Latest AI evaluation for an application, with its strengths + weaknesses.
    Returns None when the application has never been evaluated."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT EVALUATION_ID, APPLICATION_ID, COMPATIBILITY, TECHNICAL_MATCH,
                   EXPERIENCE_MATCH, OVERALL_SCORE, RECOMMENDATION, SUMMARY,
                   MODEL_NAME, PROMPT_TOKENS, OUTPUT_TOKENS, TOTAL_TOKENS,
                   TOTAL_SECONDS, LLM_SECONDS,
                   TO_CHAR(PROCESSED_AT, 'YYYY-MM-DD HH24:MI:SS') AS PROCESSED_AT
            FROM RECRUITMENT_AI_EVALUATIONS
            WHERE APPLICATION_ID = :app_id
            ORDER BY EVALUATION_ID DESC FETCH FIRST 1 ROWS ONLY
        """, {"app_id": app_id})
        row = cursor.fetchone()
        if not row:
            return None
        cols = [c[0].lower() for c in cursor.description]
        ev = dict(zip(cols, row))
        ev["recommendation"] = _lob(ev.get("recommendation"))
        ev["summary"] = _lob(ev.get("summary"))
        eid = ev["evaluation_id"]

        cursor.execute("""
            SELECT STRENGTH FROM RECRUITMENT_AI_STRENGTHS
            WHERE EVALUATION_ID = :eid ORDER BY STRENGTH_ID
        """, {"eid": eid})
        ev["strengths"] = [_lob(r[0]) for r in cursor.fetchall() if r[0] is not None]

        cursor.execute("""
            SELECT WEAKNESS FROM RECRUITMENT_AI_WEAKNESSES
            WHERE EVALUATION_ID = :eid ORDER BY WEAKNESS_ID
        """, {"eid": eid})
        ev["weaknesses"] = [_lob(r[0]) for r in cursor.fetchall() if r[0] is not None]
        return ev
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# TALENT-POOL MATCHING (Flow 2) -- rank existing candidates for a job.
# ------------------------------------------------------------------

_MATCH_STOPWORDS = {
    "and", "or", "the", "a", "an", "to", "of", "in", "for", "with", "on", "at",
    "is", "are", "be", "as", "we", "you", "our", "your", "will", "have", "has",
    "who", "this", "that", "job", "role", "work", "team", "years", "year",
    "experience", "skills", "required", "requirements", "responsibilities",
    "looking", "candidate", "candidates", "ability", "strong", "good",
}


def _tokenize(text: str) -> set:
    """Lowercase word tokens (len >= 2) minus common stopwords, for cheap
    keyword-overlap scoring (Stage 1, no LLM)."""
    if not text:
        return set()
    toks = re.findall(r"[a-z0-9\+\#\.]{2,}", str(text).lower())
    return {t for t in toks if t not in _MATCH_STOPWORDS}


def match_candidates_for_job(job_id: int, top: int = 20,
                             compc=None, brnch=None) -> dict:
    """Stage-1 (cheap, no-LLM) ranking of the whole talent pool against a job:
    score = skill overlap (weighted) + preferred-title similarity + experience
    keyword hits against the JD text. Returns the job plus the top-N candidates,
    each with a score, the overlapping skills, and whether they already have an
    application/evaluation for this job."""
    ensure_candidate_sequences()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        job = _get_job_scope(cursor, int(job_id))
        if job is None:
            return {"status": "error", "message": f"Job {job_id} not found"}
        job_title, job_desc, skills_req, job_compc, job_brnch = job

        jd_tokens = _tokenize(" ".join(filter(None, [job_desc, skills_req])))
        req_skill_tokens = _tokenize(skills_req) or jd_tokens
        title_tokens = _tokenize(job_title)

        # Pull candidates in the given scope with their skills + experience text.
        params = {}
        scope = _candidate_scope_filter(params, compc, brnch)
        where = ("WHERE 1=1" + scope) if scope else ""

        def _run(w, p):
            cursor.execute(f"""
                SELECT c.CANDIDATE_ID, c.CANDIDATE_NAME, c.PREFERRED_JOB_TITLE,
                       c.LOCATION, c.EMAIL, c.MOBILE,
                       (SELECT LISTAGG(s.SKILL_NAME, '||') WITHIN GROUP (ORDER BY s.SKILL_ID)
                        FROM RECRUITMENT_CANDIDATE_SKILLS s
                        WHERE s.CANDIDATE_ID = c.CANDIDATE_ID) AS SKILLS,
                       (SELECT LISTAGG(x.ROLE || ' ' || NVL(x.COMPANY,' '), ' ')
                               WITHIN GROUP (ORDER BY x.EXPERIENCE_ID)
                        FROM RECRUITMENT_CANDIDATE_EXPERIENCE x
                        WHERE x.CANDIDATE_ID = c.CANDIDATE_ID) AS EXP_TEXT
                FROM RECRUITMENT_CANDIDATES c
                {w}
            """, p)
            cols = [d[0].lower() for d in cursor.description]
            return [dict(zip(cols, r)) for r in cursor.fetchall()]

        try:
            rows = _run(where, params)
        except Exception as e:
            if "ORA-00904" not in str(e) or not scope:
                raise
            print(f"[RECRUITMENT] candidate COMPC/BRNCH absent, matching unscoped: {e}")
            rows = _run("", {})

        ranked = []
        for r in rows:
            skills = [s for s in (r.get("skills") or "").split("||") if s]
            skill_tokens = set()
            for s in skills:
                skill_tokens |= _tokenize(s)
            matched_skills = sorted(
                {s for s in skills if _tokenize(s) & req_skill_tokens},
                key=str.lower,
            )
            pref_tokens = _tokenize(r.get("preferred_job_title"))
            exp_tokens = _tokenize(r.get("exp_text"))

            skill_score = 10 * len(skill_tokens & req_skill_tokens)
            title_score = 6 * len(pref_tokens & title_tokens)
            exp_score = 1 * len(exp_tokens & jd_tokens)
            score = skill_score + title_score + exp_score
            if score <= 0:
                continue
            ranked.append({
                "candidate_id": int(r["candidate_id"]),
                "candidate_name": r.get("candidate_name"),
                "preferred_job_title": r.get("preferred_job_title"),
                "location": r.get("location"),
                "email": r.get("email"),
                "mobile": r.get("mobile"),
                "score": score,
                "matched_skills": matched_skills,
                "skill_matches": len(skill_tokens & req_skill_tokens),
            })

        ranked.sort(key=lambda x: (-x["score"], x["candidate_id"]))
        top_n = ranked[: max(int(top), 0)]

        # Annotate which of the top already have an application for this job.
        if top_n:
            ids = [c["candidate_id"] for c in top_n]
            ph = ", ".join(f":a{i}" for i in range(len(ids)))
            ap = {f"a{i}": v for i, v in enumerate(ids)}
            ap["jid"] = int(job_id)
            cursor.execute(f"""
                SELECT a.CANDIDATE_ID, a.APP_ID,
                       (SELECT MAX(e.OVERALL_SCORE) FROM RECRUITMENT_AI_EVALUATIONS e
                        WHERE e.APPLICATION_ID = a.APP_ID) AS AI_SCORE
                FROM RECRUITMENT_APPLICATIONS a
                WHERE a.JOB_ID = :jid AND a.CANDIDATE_ID IN ({ph})
            """, ap)
            existing = {int(r[0]): {"app_id": int(r[1]),
                                    "ai_overall_score": _r_to_int(r[2])}
                        for r in cursor.fetchall()}
            for c in top_n:
                info = existing.get(c["candidate_id"])
                c["existing_application_id"] = info["app_id"] if info else None
                c["ai_overall_score"] = info["ai_overall_score"] if info else None

        return {
            "status": "success",
            "job_id": int(job_id),
            "job_title": job_title,
            "pool_size": len(rows),
            "matched": len(ranked),
            "returned": len(top_n),
            "candidates": top_n,
        }
    finally:
        cursor.close()
        conn.close()


def create_application_for_candidate(candidate_id: int, job_id: int,
                                     source: str = None) -> dict:
    """Ensure an application exists for candidate x job (used by deep matching to
    materialise applications for shortlisted pool candidates). Returns
    {status, application_id, created}."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT CANDIDATE_NAME, MOBILE, EMAIL FROM RECRUITMENT_CANDIDATES
            WHERE CANDIDATE_ID = :cid
        """, {"cid": candidate_id})
        cand = cursor.fetchone()
        if not cand:
            return {"status": "error", "message": "Candidate not found"}
        app_id, created = _find_or_create_application_tx(
            cursor, candidate_id, int(job_id),
            name=cand[0], mobile=cand[1], email=cand[2], source=source or "Talent Match")
        conn.commit()
        return {"status": "success", "application_id": app_id, "created": created}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


def get_candidate_cv_text(candidate_id: int):
    """Reconstruct a candidate's 'CV text' from their stored profile (summary +
    education + experience + skills) so deep matching can feed it to the LLM
    evaluator without re-reading the PDF. Returns
    {text, detected_job_title, name, mobile, email} or None."""
    cand = get_candidate(candidate_id)
    if not cand:
        return None
    parts = [f"Name: {cand.get('candidate_name')}"]
    if cand.get("preferred_job_title"):
        parts.append(f"Preferred Job Title: {cand['preferred_job_title']}")
    if cand.get("location"):
        parts.append(f"Location: {cand['location']}")
    if cand.get("profile_summary"):
        parts.append(f"\nSummary:\n{cand['profile_summary']}")
    if cand.get("skills"):
        parts.append("\nSkills: " + ", ".join(cand["skills"]))
    if cand.get("experience"):
        parts.append("\nExperience:")
        for x in cand["experience"]:
            line = f"- {x.get('role') or ''} at {x.get('company') or ''} ({x.get('duration') or ''})"
            if x.get("description"):
                line += f": {x['description']}"
            parts.append(line)
    if cand.get("education"):
        parts.append("\nEducation:")
        for e in cand["education"]:
            parts.append(f"- {e.get('degree') or ''}, {e.get('institution') or ''} ({e.get('graduation_year') or ''})")
    return {
        "text": "\n".join(parts),
        "detected_job_title": cand.get("preferred_job_title"),
        "name": cand.get("candidate_name"),
        "mobile": cand.get("mobile"),
        "email": cand.get("email"),
    }


def store_evaluation(application_id: int, evaluation: dict, stats: dict,
                     total_seconds=None, processed_at=None) -> dict:
    """Public wrapper: store one evaluation (+ strengths/weaknesses) for an
    existing application and commit. Used by deep talent-pool matching, which
    reuses a candidate's stored profile as the 'CV text' rather than a PDF."""
    ensure_ai_eval_sequences()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        evaluation_id = _store_evaluation_tx(
            cursor, application_id, evaluation, stats, total_seconds, processed_at)
        conn.commit()
        return {"status": "success", "evaluation_id": evaluation_id}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


def get_job_scope(job_id: int):
    """Public: {job_id, job_title, compc, brnch} for a job, or None. Used by the
    CV-upload endpoint to place the file under the job's company folder."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        job = _get_job_scope(cursor, int(job_id))
        if job is None:
            return None
        title, _desc, _skills, compc, brnch = job
        return {"job_id": int(job_id), "job_title": title, "compc": compc, "brnch": brnch}
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# TOP-K APPLICANT RANKING (per job) -- the AI shortlist screen.
#
# Ranks the people who have APPLIED to a specific job by their stored AI
# evaluation (overall score), newest evaluation per application. Unlike
# match_candidates_for_job (which scores the whole talent pool), this only ranks
# actual applicants of the job. Scoped by the job's company/branch.
# ------------------------------------------------------------------

def _score_band(score):
    """Bucket an overall score for UI colouring / filtering.
    strong >= 75 (green), review 40-74 (amber, "AI flagged"), weak < 40 (red)."""
    s = _r_to_int(score)
    if s is None:
        return None
    if s >= 75:
        return "strong"
    if s >= 40:
        return "review"
    return "weak"


def rank_job_applicants(job_id: int, top_k: int = 10, compc=None, brnch=None) -> dict:
    """Return the job's applicants ranked by AI overall score (highest first),
    limited to the top `top_k`. Applicants without an evaluation yet are included
    but sorted last (they show as 'Pending'). Scoped to the job's company/branch."""
    ensure_ai_eval_sequences()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        job = _get_job_scope(cursor, int(job_id))
        if job is None:
            return {"status": "error", "message": f"Job {job_id} not found"}
        job_title = job[0]

        # Enforce company/branch scope on the job itself (an applicant of a job
        # belongs to that job's company/branch). Falls back to unscoped if the
        # COMPC/BRNCH columns are absent (ORA-00904).
        params = {"jid": int(job_id)}
        scope = _job_scope_filter(params, compc, brnch)

        def _run(scope_sql, p):
            cursor.execute(f"""
                SELECT a.APP_ID, a.CANDIDATE_ID, a.CANDIDATE_NAME, a.EMAIL, a.MOBILE,
                       a.STATUS, TO_CHAR(a.APP_DATE, 'YYYY-MM-DD') AS APP_DATE,
                       a.SOURCE,
                       c.PREFERRED_JOB_TITLE, c.CV_FILE_NAME, c.LOCATION,
                       e.EVALUATION_ID, e.OVERALL_SCORE, e.COMPATIBILITY,
                       e.TECHNICAL_MATCH, e.EXPERIENCE_MATCH, e.RECOMMENDATION,
                       e.SUMMARY, e.MODEL_NAME,
                       TO_CHAR(e.PROCESSED_AT, 'YYYY-MM-DD HH24:MI:SS') AS PROCESSED_AT
                FROM RECRUITMENT_APPLICATIONS a
                JOIN RECRUITMENT_JOBS j ON j.JOB_ID = a.JOB_ID
                LEFT JOIN RECRUITMENT_CANDIDATES c ON c.CANDIDATE_ID = a.CANDIDATE_ID
                LEFT JOIN RECRUITMENT_AI_EVALUATIONS e ON e.EVALUATION_ID = (
                    SELECT MAX(e2.EVALUATION_ID) FROM RECRUITMENT_AI_EVALUATIONS e2
                    WHERE e2.APPLICATION_ID = a.APP_ID
                )
                WHERE a.JOB_ID = :jid {scope_sql}
                ORDER BY e.OVERALL_SCORE DESC NULLS LAST, a.APP_ID DESC
            """, p)
            cols = [d[0].lower() for d in cursor.description]
            return [dict(zip(cols, r)) for r in cursor.fetchall()]

        try:
            rows = _run(scope, params)
        except Exception as ex:
            if "ORA-00904" not in str(ex) or not scope:
                raise
            print(f"[RECRUITMENT] job COMPC/BRNCH absent, ranking unscoped: {ex}")
            rows = _run("", {"jid": int(job_id)})

        applicants = []
        counts = {"total": 0, "evaluated": 0, "pending": 0, "flagged": 0,
                  "shortlisted": 0, "rejected": 0}
        for r in rows:
            score = _r_to_int(r.get("overall_score"))
            band = _score_band(score)
            status = (r.get("status") or "PENDING").upper()
            counts["total"] += 1
            if score is not None:
                counts["evaluated"] += 1
            else:
                counts["pending"] += 1
            if band == "review":
                counts["flagged"] += 1
            if status == "SHORTLISTED":
                counts["shortlisted"] += 1
            elif status == "REJECTED":
                counts["rejected"] += 1
            applicants.append({
                "app_id": int(r["app_id"]),
                "candidate_id": _r_to_int(r.get("candidate_id")),
                "candidate_name": r.get("candidate_name"),
                "email": r.get("email"),
                "mobile": r.get("mobile"),
                "location": r.get("location"),
                "preferred_job_title": r.get("preferred_job_title"),
                "cv_file_name": r.get("cv_file_name"),
                "status": status,
                "source": r.get("source"),
                "app_date": r.get("app_date"),
                "evaluation_id": _r_to_int(r.get("evaluation_id")),
                "overall_score": score,
                "compatibility": _r_to_int(r.get("compatibility")),
                "technical_match": _r_to_int(r.get("technical_match")),
                "experience_match": _r_to_int(r.get("experience_match")),
                "recommendation": _lob(r.get("recommendation")),
                "ai_note": _lob(r.get("summary")),
                "model_name": r.get("model_name"),
                "processed_at": r.get("processed_at"),
                "score_band": band,          # strong / review / weak / None
                "ai_flagged": band == "review",
            })

        k = max(int(top_k), 0)
        return {
            "status": "success",
            "job_id": int(job_id),
            "job_title": job_title,
            "top_k": k,
            "counts": counts,
            "candidates": applicants[:k] if k else applicants,
        }
    finally:
        cursor.close()
        conn.close()


def build_job_jd_text(job_id) -> str | None:
    """Assemble the job-description text the AI scores a CV against, from the DB
    job record: title, employment type / work mode, description, must-have and
    nice-to-have skills, minimum experience and education. This is what feeds the
    evaluator now (replacing the old per-folder job_description.txt), so the
    structured job fields directly influence the AI score."""
    job = get_job(int(job_id))
    if not job:
        return None
    lines = []
    if job.get("job_title"):
        lines.append(f"Job Title: {job['job_title']}")
    meta = " | ".join(x for x in (job.get("employment_type"), job.get("work_mode")) if x)
    if meta:
        lines.append(meta)
    if job.get("job_desc"):
        lines.append(f"\nDescription:\n{job['job_desc']}")
    if job.get("skills_req"):
        lines.append(f"\nMust-have skills: {job['skills_req']}")
    if job.get("nice_to_have_skills"):
        lines.append(f"Nice-to-have skills: {job['nice_to_have_skills']}")
    if job.get("min_experience_years") is not None:
        lines.append(f"Minimum experience: {job['min_experience_years']} years")
    if job.get("education_req"):
        lines.append(f"Education requirement: {job['education_req']}")
    text = "\n".join(lines).strip()
    return text or None


def _company_branch_parts(cursor, compc, brnch) -> list:
    """Folder-name parts [<Company>, <Branch?>] for the EMP_DOCS hierarchy, using
    the real UNIT_MST / COM_LOCATION names (branch omitted when company-wide)."""
    parts = []
    cval, bval = _r_to_int(compc), _r_to_int(brnch)
    if cval is not None:
        from repositories.document_repository import _safe_name
        company_name = None
        try:
            cursor.execute("SELECT UNIT_NAME FROM UNIT_MST WHERE UNIT_ID = :u", {"u": cval})
            r = cursor.fetchone()
            company_name = r[0] if r else None
        except Exception:
            pass
        parts.append(_safe_name(company_name, f"Comp{cval}"))
        if bval is not None:
            branch_name = None
            try:
                cursor.execute("SELECT DESCR FROM COM_LOCATION WHERE LCODE = :l", {"l": str(bval)})
                r = cursor.fetchone()
                branch_name = r[0] if r else None
            except Exception:
                pass
            parts.append(_safe_name(branch_name, f"branch{bval}"))
    return parts


def job_cv_dirs(job_id) -> dict | None:
    """Filesystem folders for a job's AI screening, under the shared employee
    documents tree, mirroring where per-candidate CVs already live:
        EMP_DOCS/<Company>/<Branch?>/RECRUITMENT_CVS/<job_id>/   (HR drop zone)
        EMP_DOCS/<Company>/<Branch?>/CV_Archive/<job_id>/        (processed)
    The watcher discovers CVs here and maps the <job_id> folder back to the job.
    Returns {buffer_dir, archive_dir, job_folder, compc, brnch} or None."""
    import os
    from repositories.document_repository import DOCS_ROOT

    conn = get_connection()
    cursor = conn.cursor()
    try:
        scope = _get_job_scope(cursor, int(job_id))
        if scope is None:
            return None
        _title, _desc, _skills, compc, brnch = scope
        parts = _company_branch_parts(cursor, compc, brnch)
        job_folder = str(int(job_id))
        return {
            "buffer_dir": os.path.join(DOCS_ROOT, *parts, "RECRUITMENT_CVS", job_folder),
            "archive_dir": os.path.join(DOCS_ROOT, *parts, "CV_Archive", job_folder),
            "job_folder": job_folder, "compc": compc, "brnch": brnch,
        }
    finally:
        cursor.close()
        conn.close()


def pool_cv_dirs(compc, brnch) -> dict:
    """Filesystem folders for job-LESS talent-pool CV intake (no application/eval),
    for a company/branch:
        EMP_DOCS/<Company>/<Branch?>/RECRUITMENT_CVS/pool/
        EMP_DOCS/<Company>/<Branch?>/CV_Archive/pool/
    Returns {buffer_dir, archive_dir, job_folder='pool', compc, brnch}."""
    import os
    from repositories.document_repository import DOCS_ROOT

    conn = get_connection()
    cursor = conn.cursor()
    try:
        parts = _company_branch_parts(cursor, compc, brnch)
        return {
            "buffer_dir": os.path.join(DOCS_ROOT, *parts, "RECRUITMENT_CVS", "pool"),
            "archive_dir": os.path.join(DOCS_ROOT, *parts, "CV_Archive", "pool"),
            "job_folder": "pool", "compc": _r_to_int(compc), "brnch": _r_to_int(brnch),
        }
    finally:
        cursor.close()
        conn.close()


def cv_status_in_dirs(buffer_dir: str, archive_dir: str, filenames) -> dict:
    """Per-file processing status for uploaded CVs, for the upload UI to poll. For
    each saved filename one of:
        processing  -- still in the RECRUITMENT_CVS drop folder
        scored      -- archived with an evaluation JSON (job upload; score included)
        profiled    -- archived with a metrics-only JSON (pool upload, no scoring)
        unreadable  -- extraction failed (no text even after OCR) -> .error.json
        failed      -- persisted-with-error -> .dberror.json
        unknown     -- not found (never uploaded, or mid-write)
    Returns {files: {name: {state, score}}}."""
    import os
    import json as _json

    out = {}
    for raw in (filenames or []):
        name = os.path.basename(str(raw))
        stem = os.path.splitext(name)[0]
        info = {"state": "unknown", "score": None}
        err = os.path.join(archive_dir, stem + ".error.json")
        dberr = os.path.join(archive_dir, stem + ".dberror.json")
        ev = os.path.join(archive_dir, stem + ".json")
        if os.path.isfile(err):
            info["state"] = "unreadable"
        elif os.path.isfile(ev):
            try:
                with open(ev, encoding="utf-8") as fh:
                    data = _json.load(fh)
            except Exception:
                data = {}
            evaluation = data.get("evaluation")
            if evaluation:
                info["state"] = "scored"
                info["score"] = evaluation.get("overall_score")
            else:
                info["state"] = "profiled"  # metrics only, no job scoring
            if os.path.isfile(dberr):
                info["state"] = "failed"
        elif os.path.isfile(os.path.join(buffer_dir, name)):
            info["state"] = "processing"
        out[name] = info
    return {"files": out}


def persist_cv_profile(compc, brnch, assessment: dict,
                       cv_file_name: str = None, cv_file_path: str = None) -> dict:
    """Persist ONLY the candidate profile from a CV (no application, no evaluation)
    -- used when a CV is added to the talent pool without applying to a job. Upserts
    the candidate (deduped by email/mobile within the company) and replaces their
    education/experience/skills from the fresh extraction, in one transaction.
    Returns {status, candidate_id, candidate_created}."""
    ensure_candidate_sequences()
    metrics = assessment.get("metrics") or {}
    conn = get_connection()
    cursor = conn.cursor()
    try:
        candidate_id, created = _upsert_candidate_tx(
            cursor, metrics, compc, brnch, cv_file_name, cv_file_path)
        conn.commit()
        return {"status": "success", "candidate_id": candidate_id,
                "candidate_created": created}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()
