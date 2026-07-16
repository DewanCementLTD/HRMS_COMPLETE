"""Interview Panel Pool + Interviewer Assignments + Interview Types.

INTERVIEW_PANEL_POOL — which active employees may conduct interviews, scoped
per (COMPC, BRNCH). One row per company+branch+employee; membership is soft:
IS_ACTIVE Y/N (never deleted, so historical assignments keep resolving).
"All Branches" adds/removes fan out to one row per branch of the company at
action time — no BRNCH='ALL'/NULL rows are ever stored, and branches created
later are NOT retroactively included.

INTERVIEW_ASSIGNMENTS — one row per interviewer per scheduled interview for an
application (no comma-separated lists). Carries INTERVIEW_TYPE + DATE + start/
end times; saving validates every interviewer is an active pool member of the
application's company/branch and has no date+time overlap with any other
PENDING assignment of theirs.

INTERVIEW_TYPES — setup-master LOV (per company, optional branch); global rows
(COMPC NULL) are seeded once and visible to every company.

No name/email columns anywhere here — display fields are joined from
HR_EMP_MASTER at read time.
"""

from core.database import get_connection

# ------------------------------------------------------------------
# DDL — idempotent, degrades gracefully without DDL rights
# ------------------------------------------------------------------

_tables_ready = False

_DDL = (
    ("INTERVIEW_PANEL_POOL", """
        CREATE TABLE INTERVIEW_PANEL_POOL (
            PANEL_POOL_ID  NUMBER PRIMARY KEY,
            COMPC          NUMBER NOT NULL,
            BRNCH          NUMBER NOT NULL,
            EMPCODE        VARCHAR2(20) NOT NULL,
            IS_ACTIVE      VARCHAR2(1) DEFAULT 'Y' NOT NULL,
            ADDED_BY       VARCHAR2(20) NOT NULL,
            ADDED_ON       TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
            CONSTRAINT UQ_PANEL_POOL UNIQUE (COMPC, BRNCH, EMPCODE)
        )"""),
    ("INTERVIEW_ASSIGNMENTS", """
        CREATE TABLE INTERVIEW_ASSIGNMENTS (
            ASSIGNMENT_ID  NUMBER PRIMARY KEY,
            APP_ID         NUMBER NOT NULL,
            INTERVIEW_ID   NUMBER,
            EMPCODE        VARCHAR2(20) NOT NULL,
            INTERVIEW_TYPE VARCHAR2(50) NOT NULL,
            INTERVIEW_DATE DATE NOT NULL,
            START_TIME     VARCHAR2(5) NOT NULL,
            END_TIME       VARCHAR2(5) NOT NULL,
            ASSIGNED_BY    VARCHAR2(20) NOT NULL,
            ASSIGNED_ON    TIMESTAMP DEFAULT SYSTIMESTAMP NOT NULL,
            STATUS         VARCHAR2(10) DEFAULT 'PENDING' NOT NULL,
            REMARKS        VARCHAR2(500)
        )"""),
    ("INTERVIEW_TYPES", """
        CREATE TABLE INTERVIEW_TYPES (
            TYPE_ID   NUMBER PRIMARY KEY,
            DESCR     VARCHAR2(50) NOT NULL,
            COMPC     NUMBER,
            BRNCH     NUMBER,
            IS_ACTIVE VARCHAR2(1) DEFAULT 'Y' NOT NULL
        )"""),
)

_SEQS = ("INTERVIEW_PANEL_POOL_SEQ", "INTERVIEW_ASSIGNMENTS_SEQ", "INTERVIEW_TYPES_SEQ")

_DEFAULT_TYPES = ("HR", "Technical", "Managerial", "Final")


def ensure_interview_tables():
    """Create the three tables + sequences and seed the global interview types.
    Safe to call repeatedly (ORA-00955 'name already used' means it exists)."""
    global _tables_ready
    if _tables_ready:
        return
    conn = get_connection()
    cursor = conn.cursor()
    try:
        for name, ddl in _DDL:
            try:
                cursor.execute(ddl)
                print(f"[INTERVIEW] Created table {name}")
            except Exception as e:
                if "ORA-00955" not in str(e):
                    print(f"[INTERVIEW] Could not create {name}: {str(e).splitlines()[0]}")
        for seq in _SEQS:
            try:
                cursor.execute(f"CREATE SEQUENCE {seq} START WITH 1 NOCACHE")
                print(f"[INTERVIEW] Created sequence {seq}")
            except Exception as e:
                if "ORA-00955" not in str(e):
                    print(f"[INTERVIEW] Could not create {seq}: {str(e).splitlines()[0]}")
        # Venue fields on the interview event — the notification message bodies
        # ({{location_or_link}}, {{interview_mode}}) are captured at scheduling.
        for coldef in ("LOCATION_OR_LINK VARCHAR2(300)", "INTERVIEW_MODE VARCHAR2(30)"):
            try:
                cursor.execute(f"ALTER TABLE RECRUITMENT_INTERVIEWS ADD ({coldef})")
                print(f"[INTERVIEW] Added column {coldef.split()[0]} to RECRUITMENT_INTERVIEWS")
            except Exception as e:
                if "ORA-01430" not in str(e):
                    print(f"[INTERVIEW] Could not add {coldef.split()[0]}: {str(e).splitlines()[0]}")
        # Seed the global (COMPC NULL) interview types once.
        try:
            cursor.execute("SELECT COUNT(*) FROM INTERVIEW_TYPES WHERE COMPC IS NULL")
            if int(cursor.fetchone()[0]) == 0:
                for d in _DEFAULT_TYPES:
                    cursor.execute("""
                        INSERT INTO INTERVIEW_TYPES (TYPE_ID, DESCR, COMPC, BRNCH)
                        VALUES (INTERVIEW_TYPES_SEQ.NEXTVAL, :d, NULL, NULL)
                    """, {"d": d})
                conn.commit()
                print(f"[INTERVIEW] Seeded {len(_DEFAULT_TYPES)} global interview types")
        except Exception as e:
            print(f"[INTERVIEW] Could not seed types: {str(e).splitlines()[0]}")
        _tables_ready = True
    finally:
        cursor.close()
        conn.close()


def _to_int(v):
    try:
        return int(float(str(v).strip()))
    except (ValueError, TypeError):
        return None


def _company_branches(cursor, compc) -> list:
    """All branch codes (COM_LOCATION.LCODE) of a company — the fan-out target
    for 'All Branches' actions and the denominator for the grouped display."""
    cursor.execute(
        "SELECT LCODE FROM COM_LOCATION WHERE TO_CHAR(COMPC) = TO_CHAR(:c)",
        {"c": str(compc)})
    return sorted({n for n in (_to_int(r[0]) for r in cursor.fetchall()) if n is not None})


def _resolve_target_branches(cursor, compc, brnch) -> list:
    """The branches an add/deactivate applies to: the selected one, or every
    branch of the company when the view is 'All Branches' (brnch None)."""
    b = _to_int(brnch)
    if b is not None:
        return [b]
    branches = _company_branches(cursor, compc)
    if not branches:
        raise ValueError(f"Company {compc} has no branches in COM_LOCATION")
    return branches


# ------------------------------------------------------------------
# PANEL POOL
# ------------------------------------------------------------------

def list_panel_pool(compc, brnch=None, include_inactive: bool = False) -> dict:
    """Pool rows for a company (one branch, or all when brnch None), joined to
    HR_EMP_MASTER for display. Returns {items, company_branches} — the branch
    list lets the UI collapse an employee active in EVERY branch into a single
    'All Branches' entry (derived, never stored)."""
    ensure_interview_tables()
    c = _to_int(compc)
    if c is None:
        return {"items": [], "company_branches": []}
    conn = get_connection()
    cursor = conn.cursor()
    try:
        params = {"c": c}
        conds = ["p.COMPC = :c"]
        b = _to_int(brnch)
        if b is not None:
            conds.append("p.BRNCH = :b")
            params["b"] = b
        if not include_inactive:
            conds.append("p.IS_ACTIVE = 'Y'")
        cursor.execute(f"""
            SELECT p.PANEL_POOL_ID, p.COMPC, p.BRNCH, p.EMPCODE, p.IS_ACTIVE,
                   p.ADDED_BY, TO_CHAR(p.ADDED_ON, 'YYYY-MM-DD') AS ADDED_ON,
                   h.NAME, h.STATUS AS EMP_STATUS,
                   (SELECT MAX(l.DESCR) FROM COM_LOCATION l
                     WHERE TO_NUMBER(l.LCODE) = p.BRNCH
                       AND TO_CHAR(l.COMPC) = TO_CHAR(p.COMPC)) AS BRNCH_NAME
            FROM INTERVIEW_PANEL_POOL p
            LEFT JOIN HR_EMP_MASTER h ON h.EMPCODE = p.EMPCODE
            WHERE {' AND '.join(conds)}
            ORDER BY h.NAME, p.BRNCH
        """, params)
        cols = [d[0].lower() for d in cursor.description]
        items = [dict(zip(cols, r)) for r in cursor.fetchall()]
        cursor.execute(
            "SELECT LCODE, DESCR FROM COM_LOCATION WHERE TO_CHAR(COMPC) = TO_CHAR(:c)",
            {"c": str(c)})
        branches = [{"lcode": _to_int(r[0]), "descr": (r[1] or "").strip()}
                    for r in cursor.fetchall() if _to_int(r[0]) is not None]
        return {"items": items, "company_branches": branches}
    finally:
        cursor.close()
        conn.close()


def add_panel_members(compc, brnch, empcodes: list, added_by: str) -> dict:
    """Add employees to the pool. brnch None = 'All Branches' → one row per
    branch of the company (snapshot at action time). Upsert: an existing
    (compc, brnch, empcode) row is reactivated instead of duplicated. Only
    active (STATUS='A') employees of that company are accepted."""
    ensure_interview_tables()
    c = _to_int(compc)
    if c is None:
        return {"status": "error", "message": "A specific company is required"}
    codes = [str(e).strip() for e in (empcodes or []) if str(e).strip()]
    if not codes:
        return {"status": "error", "message": "No employees given"}
    conn = get_connection()
    cursor = conn.cursor()
    try:
        branches = _resolve_target_branches(cursor, c, brnch)

        # Server-side guard: only currently-active employees of this company.
        ph = ", ".join(f":e{i}" for i in range(len(codes)))
        cursor.execute(f"""
            SELECT EMPCODE FROM HR_EMP_MASTER
            WHERE EMPCODE IN ({ph}) AND STATUS = 'A'
              AND TO_NUMBER(UNIT_ID) = :c
        """, {**{f"e{i}": v for i, v in enumerate(codes)}, "c": c})
        valid = {str(r[0]).strip() for r in cursor.fetchall()}
        rejected = [e for e in codes if e not in valid]
        if not valid:
            return {"status": "error",
                    "message": "No active employees of this company in the selection",
                    "rejected": rejected}

        inserted = reactivated = unchanged = 0
        for emp in sorted(valid):
            for b in branches:
                cursor.execute("""
                    UPDATE INTERVIEW_PANEL_POOL SET IS_ACTIVE = 'Y'
                    WHERE COMPC = :c AND BRNCH = :b AND EMPCODE = :e
                """, {"c": c, "b": b, "e": emp})
                if cursor.rowcount:
                    reactivated += cursor.rowcount
                    continue
                cursor.execute("""
                    INSERT INTO INTERVIEW_PANEL_POOL
                        (PANEL_POOL_ID, COMPC, BRNCH, EMPCODE, IS_ACTIVE, ADDED_BY, ADDED_ON)
                    VALUES (INTERVIEW_PANEL_POOL_SEQ.NEXTVAL, :c, :b, :e, 'Y', :addedby, SYSTIMESTAMP)
                """, {"c": c, "b": b, "e": emp,
                      "addedby": (str(added_by or "").strip() or "SYSTEM")[:20]})
                inserted += 1
        conn.commit()
        return {"status": "success", "inserted": inserted, "reactivated": reactivated,
                "unchanged": unchanged, "branches": branches, "rejected": rejected}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


def deactivate_panel_row(panel_pool_id: int) -> dict:
    """Soft-remove ONE pool row (a single company+branch membership)."""
    ensure_interview_tables()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(
            "UPDATE INTERVIEW_PANEL_POOL SET IS_ACTIVE = 'N' WHERE PANEL_POOL_ID = :id",
            {"id": panel_pool_id})
        conn.commit()
        if cursor.rowcount == 0:
            return {"status": "error", "message": "Pool member not found"}
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


def deactivate_panel_member(compc, brnch, empcode: str) -> dict:
    """Soft-remove an employee from the pool in the current scope: the selected
    branch, or — in the 'All Branches' view — EVERY branch of the company."""
    ensure_interview_tables()
    c = _to_int(compc)
    if c is None:
        return {"status": "error", "message": "A specific company is required"}
    conn = get_connection()
    cursor = conn.cursor()
    try:
        branches = _resolve_target_branches(cursor, c, brnch)
        ph = ", ".join(f":b{i}" for i in range(len(branches)))
        cursor.execute(f"""
            UPDATE INTERVIEW_PANEL_POOL SET IS_ACTIVE = 'N'
            WHERE COMPC = :c AND EMPCODE = :e AND BRNCH IN ({ph})
        """, {"c": c, "e": str(empcode).strip(),
              **{f"b{i}": b for i, b in enumerate(branches)}})
        conn.commit()
        return {"status": "success", "deactivated": cursor.rowcount}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# ASSIGNMENTS
# ------------------------------------------------------------------

def _app_scope(cursor, app_id: int):
    """(compc, brnch) of an application via its job. Returns None when the
    application doesn't exist."""
    cursor.execute("""
        SELECT j.COMPC, j.BRNCH
        FROM RECRUITMENT_APPLICATIONS a
        JOIN RECRUITMENT_JOBS j ON j.JOB_ID = a.JOB_ID
        WHERE a.APP_ID = :id
    """, {"id": app_id})
    row = cursor.fetchone()
    return (_to_int(row[0]), _to_int(row[1])) if row else None


def panel_options_for_app(app_id: int) -> dict:
    """Active pool members eligible to interview for this application: the
    job's company + branch. A company-wide job (BRNCH NULL) draws from every
    branch's pool of that company. One entry per employee (branches merged)."""
    ensure_interview_tables()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        scope = _app_scope(cursor, app_id)
        if scope is None:
            return {"status": "error", "message": "Application not found"}
        compc, brnch = scope
        params = {"c": compc}
        conds = ["p.IS_ACTIVE = 'Y'"]
        if compc is not None:
            conds.append("p.COMPC = :c")
        else:
            params.pop("c")
        if brnch is not None:
            conds.append("p.BRNCH = :b")
            params["b"] = brnch
        cursor.execute(f"""
            SELECT p.EMPCODE, MAX(h.NAME) AS NAME,
                   LISTAGG(TO_CHAR(p.BRNCH), ',') WITHIN GROUP (ORDER BY p.BRNCH) AS BRANCHES
            FROM INTERVIEW_PANEL_POOL p
            LEFT JOIN HR_EMP_MASTER h ON h.EMPCODE = p.EMPCODE
            WHERE {' AND '.join(conds)}
            GROUP BY p.EMPCODE
            ORDER BY MAX(h.NAME)
        """, params)
        items = [{"empcode": str(r[0]).strip(), "name": (r[1] or "").strip() or None,
                  "branches": (r[2] or "")} for r in cursor.fetchall()]
        return {"status": "success", "compc": compc, "brnch": brnch, "items": items}
    finally:
        cursor.close()
        conn.close()


_TIME_FMT_ERR = "Times must be HH:MM (24-hour), e.g. 09:30"


def _norm_time(t: str) -> str:
    """Normalize 'H:MM'/'HH:MM' to zero-padded 'HH:MM' (string-comparable)."""
    parts = str(t or "").strip().split(":")
    if len(parts) != 2 or not parts[0].isdigit() or not parts[1].isdigit():
        raise ValueError(_TIME_FMT_ERR)
    h, m = int(parts[0]), int(parts[1])
    if not (0 <= h <= 23 and 0 <= m <= 59):
        raise ValueError(_TIME_FMT_ERR)
    return f"{h:02d}:{m:02d}"


def _plus_hour(t: str) -> str:
    h, m = map(int, t.split(":"))
    return f"{min(h + 1, 23):02d}:{m:02d}" if h < 23 else "23:59"


def create_interview_assignments(app_id: int, empcodes: list, interview_type: str,
                                 interview_date: str, start_time: str,
                                 end_time: str = None, remarks: str = None,
                                 assigned_by: str = "", location_or_link: str = None,
                                 interview_mode: str = None) -> dict:
    """Schedule an interview: one INTERVIEW_ASSIGNMENTS row per interviewer plus
    one RECRUITMENT_INTERVIEWS event row (so the existing interview list /
    feedback flow keeps working), all in one transaction.

    Validates: interview_type + date + start_time present; every empcode is an
    ACTIVE pool member of the application's company/branch; and no interviewer
    has another PENDING assignment overlapping this date+time (409-style clash
    error listing the offenders)."""
    ensure_interview_tables()
    if not (interview_type or "").strip():
        return {"status": "error", "code": 400, "message": "interview_type is required"}
    if not (interview_date or "").strip():
        return {"status": "error", "code": 400, "message": "interview_date is required"}
    codes, seen = [], set()
    for e in (empcodes or []):
        e = str(e).strip()
        if e and e not in seen:
            seen.add(e)
            codes.append(e)
    if not codes:
        return {"status": "error", "code": 400, "message": "At least one interviewer is required"}
    try:
        start = _norm_time(start_time)
        end = _norm_time(end_time) if (end_time or "").strip() else _plus_hour(start)
    except ValueError as e:
        return {"status": "error", "code": 400, "message": str(e)}
    if end <= start:
        return {"status": "error", "code": 400, "message": "End time must be after start time"}

    conn = get_connection()
    cursor = conn.cursor()
    try:
        scope = _app_scope(cursor, app_id)
        if scope is None:
            return {"status": "error", "code": 404, "message": "Application not found"}
        compc, brnch = scope

        # Server-side pool enforcement (mirrors the UI source list).
        conds = ["IS_ACTIVE = 'Y'"]
        params = {}
        if compc is not None:
            conds.append("COMPC = :c")
            params["c"] = compc
        if brnch is not None:
            conds.append("BRNCH = :b")
            params["b"] = brnch
        ph = ", ".join(f":e{i}" for i in range(len(codes)))
        cursor.execute(f"""
            SELECT DISTINCT EMPCODE FROM INTERVIEW_PANEL_POOL
            WHERE {' AND '.join(conds)} AND EMPCODE IN ({ph})
        """, {**params, **{f"e{i}": v for i, v in enumerate(codes)}})
        in_pool = {str(r[0]).strip() for r in cursor.fetchall()}
        outsiders = [e for e in codes if e not in in_pool]
        if outsiders:
            return {"status": "error", "code": 400,
                    "message": f"Not in this company/branch's interview panel pool: {', '.join(outsiders)}"}

        # Date+time clash: same interviewer, another PENDING assignment,
        # overlapping window on the same date (start < other_end AND other_start < end).
        cursor.execute(f"""
            SELECT ia.EMPCODE, MAX(h.NAME), ia.START_TIME, ia.END_TIME
            FROM INTERVIEW_ASSIGNMENTS ia
            LEFT JOIN HR_EMP_MASTER h ON h.EMPCODE = ia.EMPCODE
            WHERE ia.STATUS = 'PENDING'
              AND ia.EMPCODE IN ({ph})
              AND ia.INTERVIEW_DATE = TO_DATE(:d, 'YYYY-MM-DD')
              AND ia.START_TIME < :endt AND :startt < ia.END_TIME
            GROUP BY ia.EMPCODE, ia.START_TIME, ia.END_TIME
        """, {**{f"e{i}": v for i, v in enumerate(codes)},
              "d": interview_date, "startt": start, "endt": end})
        clashes = [f"{(r[1] or '').strip() or r[0]} ({r[0]}) already has an interview "
                   f"{r[2]}-{r[3]} on {interview_date}" for r in cursor.fetchall()]
        if clashes:
            return {"status": "error", "code": 409,
                    "message": "Time clash: " + "; ".join(clashes)}

        # Interviewer names for the legacy RECRUITMENT_INTERVIEWS event row.
        cursor.execute(f"""
            SELECT EMPCODE, NAME FROM HR_EMP_MASTER WHERE EMPCODE IN ({ph})
        """, {f"e{i}": v for i, v in enumerate(codes)})
        names = {str(r[0]).strip(): (r[1] or "").strip() for r in cursor.fetchall()}
        display = ", ".join(f"{names.get(e) or e} ({e})" for e in codes)

        iv_out = cursor.var(int)
        cursor.execute("""
            INSERT INTO RECRUITMENT_INTERVIEWS (
                INTERVIEW_ID, APP_ID, INTERVIEW_DATE, INTERVIEW_TYPE,
                INTERVIEWER, LOCATION_OR_LINK, INTERVIEW_MODE, STATUS, CREATED_AT
            ) VALUES (
                RECRUITMENT_INTERVIEWS_SEQ.NEXTVAL, :app_id,
                TO_DATE(:d, 'YYYY-MM-DD'), :typ, :interviewer, :loc, :ivmode,
                'SCHEDULED', SYSDATE
            ) RETURNING INTERVIEW_ID INTO :out_id
        """, {"app_id": app_id, "d": interview_date,
              "typ": interview_type.strip()[:50], "interviewer": display[:200],
              "loc": (location_or_link or "").strip()[:300] or None,
              "ivmode": (interview_mode or "").strip()[:30] or None,
              "out_id": iv_out})
        interview_id = int(iv_out.getvalue()[0])

        ids = []
        for emp in codes:
            a_out = cursor.var(int)
            cursor.execute("""
                INSERT INTO INTERVIEW_ASSIGNMENTS (
                    ASSIGNMENT_ID, APP_ID, INTERVIEW_ID, EMPCODE, INTERVIEW_TYPE,
                    INTERVIEW_DATE, START_TIME, END_TIME, ASSIGNED_BY, ASSIGNED_ON,
                    STATUS, REMARKS
                ) VALUES (
                    INTERVIEW_ASSIGNMENTS_SEQ.NEXTVAL, :app_id, :iv_id, :emp, :typ,
                    TO_DATE(:d, 'YYYY-MM-DD'), :startt, :endt, :addedby, SYSTIMESTAMP,
                    'PENDING', :remarks
                ) RETURNING ASSIGNMENT_ID INTO :out_id
            """, {"app_id": app_id, "iv_id": interview_id, "emp": emp,
                  "typ": interview_type.strip()[:50], "d": interview_date,
                  "startt": start, "endt": end,
                  "addedby": (str(assigned_by or "").strip() or "SYSTEM")[:20],
                  "remarks": (remarks or "").strip()[:500] or None, "out_id": a_out})
            ids.append(int(a_out.getvalue()[0]))
        conn.commit()
        return {"status": "success", "interview_id": interview_id,
                "assignment_ids": ids, "interviewers": display}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "code": 500, "message": str(e)}
    finally:
        cursor.close()
        conn.close()


def list_interview_assignments(app_id: int) -> list:
    """Assignments for an application, newest first, names joined from
    HR_EMP_MASTER (never stored)."""
    ensure_interview_tables()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT ia.ASSIGNMENT_ID, ia.APP_ID, ia.INTERVIEW_ID, ia.EMPCODE,
                   h.NAME, ia.INTERVIEW_TYPE,
                   TO_CHAR(ia.INTERVIEW_DATE, 'YYYY-MM-DD') AS INTERVIEW_DATE,
                   ia.START_TIME, ia.END_TIME, ia.ASSIGNED_BY,
                   TO_CHAR(ia.ASSIGNED_ON, 'YYYY-MM-DD HH24:MI') AS ASSIGNED_ON,
                   ia.STATUS, ia.REMARKS
            FROM INTERVIEW_ASSIGNMENTS ia
            LEFT JOIN HR_EMP_MASTER h ON h.EMPCODE = ia.EMPCODE
            WHERE ia.APP_ID = :id
            ORDER BY ia.INTERVIEW_DATE DESC, ia.START_TIME DESC, ia.ASSIGNMENT_ID DESC
        """, {"id": app_id})
        cols = [d[0].lower() for d in cursor.description]
        return [dict(zip(cols, r)) for r in cursor.fetchall()]
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# INTERVIEW TYPES (setup-master LOV)
# ------------------------------------------------------------------

def list_interview_types(compc=None, brnch=None) -> list:
    """Active types for a company: its own rows + the global (COMPC NULL) seed
    rows. Branch-specific rows are included for the selected branch or when no
    branch is selected."""
    ensure_interview_tables()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        params = {}
        conds = ["IS_ACTIVE = 'Y'"]
        c = _to_int(compc)
        if c is not None:
            conds.append("(COMPC = :c OR COMPC IS NULL)")
            params["c"] = c
        b = _to_int(brnch)
        if b is not None:
            conds.append("(BRNCH = :b OR BRNCH IS NULL)")
            params["b"] = b
        cursor.execute(f"""
            SELECT TYPE_ID, DESCR, COMPC, BRNCH FROM INTERVIEW_TYPES
            WHERE {' AND '.join(conds)}
            ORDER BY DESCR
        """, params)
        return [{"type_id": int(r[0]), "descr": (r[1] or "").strip(),
                 "compc": _to_int(r[2]), "brnch": _to_int(r[3])}
                for r in cursor.fetchall()]
    finally:
        cursor.close()
        conn.close()


def add_interview_type(descr: str, compc=None, brnch=None) -> dict:
    ensure_interview_tables()
    d = (descr or "").strip()[:50]
    if not d:
        return {"status": "error", "message": "Description is required"}
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT COUNT(*) FROM INTERVIEW_TYPES
            WHERE UPPER(DESCR) = UPPER(:d) AND IS_ACTIVE = 'Y'
              AND (COMPC IS NULL OR COMPC = :c)
        """, {"d": d, "c": _to_int(compc)})
        if int(cursor.fetchone()[0]) > 0:
            return {"status": "error", "message": f"'{d}' already exists"}
        out = cursor.var(int)
        cursor.execute("""
            INSERT INTO INTERVIEW_TYPES (TYPE_ID, DESCR, COMPC, BRNCH)
            VALUES (INTERVIEW_TYPES_SEQ.NEXTVAL, :d, :c, :b)
            RETURNING TYPE_ID INTO :out_id
        """, {"d": d, "c": _to_int(compc), "b": _to_int(brnch), "out_id": out})
        conn.commit()
        return {"status": "success", "type_id": int(out.getvalue()[0]), "descr": d}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()


def remove_interview_type(type_id: int, compc=None) -> dict:
    """Soft-delete a type. Company-scoped rows only — the global seed rows are
    shared, so a company admin cannot remove them (matches other setup LOVs)."""
    ensure_interview_tables()
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            UPDATE INTERVIEW_TYPES SET IS_ACTIVE = 'N'
            WHERE TYPE_ID = :id AND COMPC = :c
        """, {"id": type_id, "c": _to_int(compc)})
        conn.commit()
        if cursor.rowcount == 0:
            return {"status": "error",
                    "message": "Only types added for this company can be removed."}
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()
