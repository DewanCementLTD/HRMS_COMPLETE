import hashlib
import re
import time

from core.database import get_connection
from datetime import datetime


# ===============================
# USER SECURITY RIGHTS
# ===============================

def admin_can_edit_salary(card_no: str) -> bool:
    """True if the admin (matched in SEC_USERNAME by mobile/empcode/card) has
    ULEVL='M'. Fails OPEN when the admin can't be resolved, so M-level managers
    are never wrongly blocked (the UI is the primary gate)."""
    if not card_no:
        return True
    c = str(card_no).strip()
    c0 = ("0" + c) if not c.startswith("0") else c
    cn = c[1:] if c.startswith("0") else c
    conn = get_connection(); cur = conn.cursor()
    try:
        cur.execute("""
            SELECT ULEVL FROM SEC_USERNAME WHERE STATS = 'E' AND (
                TO_CHAR(MOBILE) IN (:c, :c0, :cn)
                OR ECODE = :c
                OR ECODE IN (SELECT h.EMPCODE FROM HR_EMP_MASTER h
                             LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
                             WHERE h.EMPCODE = :c OR TO_CHAR(e.CARD_NO) = :c)
            )
        """, {"c": c, "c0": c0, "cn": cn})
        rows = cur.fetchall()
        if not rows:
            return True
        return any((r[0] or "").strip().upper() == "M" for r in rows)
    except Exception as e:
        print(f"[RIGHTS] admin_can_edit_salary check failed (allowing): {e}")
        return True
    finally:
        cur.close(); conn.close()


def get_user_rights(mobile: str, empcode: str = "") -> dict:
    """Return SEC_USERNAME company/branch rights for the given employee."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        usrid = None
        ulevel = None
        if mobile:
            m = str(mobile).strip()
            m_w   = ('0' + m) if not m.startswith('0') else m
            m_no0 = m[1:]     if m.startswith('0')     else m
            cur.execute("""
                SELECT USRID, ULEVL FROM SEC_USERNAME
                WHERE TO_CHAR(MOBILE) IN (:m1, :m2, :m3) AND STATS = 'E'
                FETCH FIRST 1 ROWS ONLY
            """, {"m1": m, "m2": m_w, "m3": m_no0})
            row = cur.fetchone()
            if row:
                usrid = str(row[0]); ulevel = (row[1] or "").strip()
        if not usrid and empcode:
            cur.execute("""
                SELECT USRID, ULEVL FROM SEC_USERNAME
                WHERE ECODE = :ec AND STATS = 'E'
                FETCH FIRST 1 ROWS ONLY
            """, {"ec": str(empcode).strip()})
            row = cur.fetchone()
            if row:
                usrid = str(row[0]); ulevel = (row[1] or "").strip()
        if not usrid:
            return {"usrid": None, "allowed_companies": [], "allowed_branches": [],
                    "company_list": [], "branch_list": [], "ulevel": None, "can_edit_salary": False}

        cur.execute("""
            SELECT sc.COMPC, NVL(ci.DESCR, TO_CHAR(sc.COMPC))
            FROM SEC_USERCMPN sc
            LEFT JOIN COMPANY_INFO ci ON ci.COMPC = sc.COMPC
            WHERE sc.USRID = :usrid ORDER BY sc.COMPC
        """, {"usrid": usrid})
        cmp_rows     = cur.fetchall()
        companies    = [str(r[0]) for r in cmp_rows]
        company_list = [{"code": str(r[0]), "name": str(r[1] or r[0])} for r in cmp_rows]

        cur.execute("""
            SELECT sb.BRNCH, NVL(cl.DESCR, TO_CHAR(sb.BRNCH)), cl.COMPC
            FROM SEC_USERBRCH sb
            LEFT JOIN COM_LOCATION cl ON TO_CHAR(cl.LCODE) = TO_CHAR(sb.BRNCH)
            WHERE sb.USRID = :usrid2 ORDER BY sb.BRNCH
        """, {"usrid2": usrid})
        brn_rows    = cur.fetchall()
        branches    = [str(r[0]) for r in brn_rows]
        branch_list = [{"code": str(r[0]), "name": str(r[1] or r[0]),
                        "compc": (str(r[2]).strip() if r[2] is not None else None)} for r in brn_rows]

        return {"usrid": usrid, "allowed_companies": companies, "allowed_branches": branches,
                "company_list": company_list, "branch_list": branch_list,
                "ulevel": ulevel, "can_edit_salary": (ulevel or "").upper() == "M"}
    except Exception as e:
        print(f"[RIGHTS] Error: {e}")
        return {"usrid": None, "allowed_companies": [], "allowed_branches": [],
                "company_list": [], "branch_list": [], "ulevel": None, "can_edit_salary": False}
    finally:
        cur.close()
        conn.close()


# ===============================
# AUTH — TWO-STEP LOGIN
# ===============================

def authenticate_user(username: str, password: str) -> dict | None:
    """Two-step login: SEC_USERNAME (MD5) first, then HR_EMP_MASTER (plain text)."""
    conn = get_connection()
    cur = conn.cursor()
    try:
        m        = str(username).strip()
        m_with0  = ('0' + m) if not m.startswith('0') else m
        m_no0    = m[1:]     if m.startswith('0')     else m

        # ── STEP 1: SEC_USERNAME (ERP HR admin) ──────────────────────
        # Fetch raw PASWD first (no decryption) so ORA-28817 on one user
        # doesn't kill the entire lookup. Decrypt separately afterwards.
        sec_row = None
        try:
            cur.execute("""
                SELECT USRID, DESCR, PASWD, MOBILE, ECODE, ULEVL
                FROM SEC_USERNAME
                WHERE TO_CHAR(MOBILE) IN (:m1, :m2, :m3) AND STATS = 'E'
                FETCH FIRST 1 ROWS ONLY
            """, {"m1": m, "m2": m_with0, "m3": m_no0})
            sec_row = cur.fetchone()
            if not sec_row:
                cur.execute("""
                    SELECT USRID, DESCR, PASWD, MOBILE, ECODE
                    FROM SEC_USERNAME WHERE ECODE = :ec AND STATS = 'E'
                    FETCH FIRST 1 ROWS ONLY
                """, {"ec": m})
                sec_row = cur.fetchone()
        except Exception as e:
            print(f"[AUTH] SEC_USERNAME query failed: {e}")

        sec_authenticated = False
        ulevl = None
        if sec_row:
            usrid, descr, raw_paswd, sec_mobile, ecode, ulevl = sec_row
            # Try to decrypt; fall back to raw comparison if decryption fails
            stored_paswd = None
            try:
                cur.execute("SELECT datacrypt.decryptdata(:p) FROM DUAL", {"p": raw_paswd})
                dec_row = cur.fetchone()
                stored_paswd = str(dec_row[0]).strip() if dec_row and dec_row[0] else None
            except Exception as e:
                print(f"[AUTH] datacrypt.decryptdata failed for USRID={usrid}: {e}")
                stored_paswd = str(raw_paswd or "").strip()

            if (stored_paswd or "").strip() == (password or "").strip():
                sec_authenticated = True
            else:
                print(f"[AUTH] SEC_USERNAME found but password mismatch for {username}, trying HR_EMP_MASTER")

        if sec_authenticated:
            # SEC_USERNAME user - HR Admin with access to company/branch management
            usrid_numeric = usrid  # Keep as numeric for database queries
            emp_name = str(descr or "").strip()  # Use DESCR from SEC_USERNAME
            empcode = str(ecode or "").strip()
            card_no = None
            has_employee_features = False  # Will be set to True only if in HR_EMP_MASTER

            # Check if SEC_USERNAME user exists in HR_EMP_MASTER (necessary for employee features)
            # First try by EMPCODE
            if empcode:
                cur.execute("""
                    SELECT TO_CHAR(e.CARD_NO), h.NAME, h.EMPCODE
                    FROM HR_EMP_MASTER h
                    LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
                    WHERE h.EMPCODE = :ec
                    FETCH FIRST 1 ROWS ONLY
                """, {"ec": empcode})
                row = cur.fetchone()
                if row:
                    card_no = str(row[0]) if row[0] else None
                    # Keep emp_name from SEC_USERNAME DESCR, don't override
                    has_employee_features = True

            # If not found by EMPCODE, try by mobile in HR_EMP_MASTER
            if not has_employee_features and sec_mobile:
                mv = str(sec_mobile).strip()
                mv_w = ('0' + mv) if not mv.startswith('0') else mv
                mv_no0 = mv[1:] if mv.startswith('0') else mv
                cur.execute("""
                    SELECT TO_CHAR(e.CARD_NO), h.NAME, h.EMPCODE
                    FROM HR_EMP_MASTER h
                    LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
                    WHERE h."MOBILE#" IN (:mv1, :mv2, :mv3)
                    FETCH FIRST 1 ROWS ONLY
                """, {"mv1": mv, "mv2": mv_w, "mv3": mv_no0})
                row = cur.fetchone()
                if row:
                    card_no = str(row[0]) if row[0] else None
                    has_employee_features = True
                    if not empcode:
                        empcode = str(row[2] or "").strip()

            # Get company and branch access rights from SEC_USERCMPN and SEC_USERBRCH
            # Use a fresh cursor to ensure clean state
            companies = []
            company_list = []
            branches = []
            branch_list = []
            
            try:
                cur2 = conn.cursor()
                try:
                    cur2.execute("""
                        SELECT sc.COMPC, NVL(ci.DESCR, TO_CHAR(sc.COMPC))
                        FROM SEC_USERCMPN sc
                        LEFT JOIN COMPANY_INFO ci ON ci.COMPC = sc.COMPC
                        WHERE sc.USRID = :usrid 
                        ORDER BY sc.COMPC
                    """, {"usrid": usrid_numeric})
                    cmp_rows = cur2.fetchall()
                    companies = [str(r[0]) for r in cmp_rows]
                    company_list = [{"code": str(r[0]), "name": str(r[1] or r[0])} for r in cmp_rows]
                    print(f"[AUTH] SEC_USERCMPN query returned {len(cmp_rows)} companies for USRID={usrid_numeric}")
                finally:
                    cur2.close()
            except Exception as e:
                print(f"[AUTH] SEC_USERCMPN query failed for USRID={usrid_numeric}: {e}")
            
            try:
                cur3 = conn.cursor()
                try:
                    cur3.execute("""
                        SELECT sb.BRNCH, NVL(cl.DESCR, TO_CHAR(sb.BRNCH)), cl.COMPC
                        FROM SEC_USERBRCH sb
                        LEFT JOIN COM_LOCATION cl ON TO_CHAR(cl.LCODE) = TO_CHAR(sb.BRNCH)
                        WHERE sb.USRID = :usrid
                        ORDER BY sb.BRNCH
                    """, {"usrid": usrid_numeric})
                    brn_rows = cur3.fetchall()
                    branches = [str(r[0]) for r in brn_rows]
                    branch_list = [{"code": str(r[0]), "name": str(r[1] or r[0]),
                                    "compc": (str(r[2]).strip() if r[2] is not None else None)} for r in brn_rows]
                    print(f"[AUTH] SEC_USERBRCH query returned {len(brn_rows)} branches for USRID={usrid_numeric}")
                finally:
                    cur3.close()
            except Exception as e:
                print(f"[AUTH] SEC_USERBRCH query failed for USRID={usrid_numeric}: {e}")

            has_self_service = has_employee_features
            print(f"[AUTH] SEC_USERNAME login: usrid={usrid_numeric}, card_no={card_no}, "
                  f"has_self_service={has_self_service}, companies={len(companies)}, branches={len(branches)}")
            return {
                "card_no": card_no or username,
                "user_paswd": None,
                "emp_name": emp_name,  # From SEC_USERNAME DESCR
                "hr_admin": "Y",  # Only SEC_USERNAME users are HR admins
                "face_registered": "N",
                "empcode": empcode,
                "allowed_companies": companies,
                "allowed_branches": branches,
                "company_list": company_list,
                "branch_list": branch_list,
                "can_edit_salary": str(ulevl or "").strip().upper() == "M",
                "has_self_service": has_self_service,
                "has_employee_features": has_employee_features,  # False if not in HR_EMP_MASTER
            }

        # ── STEP 2: HR_EMP_MASTER (normal employee) ───────────────────
        # Regular employees can only access their own data, NO HR admin features
        l     = username.strip()
        l_w0  = ('0' + l) if not l.startswith('0') else l
        l_no0 = l[1:]     if l.startswith('0')     else l
        try:
            cur.execute("""
                SELECT TO_CHAR(e.CARD_NO), h.USER_PASWD, h.NAME,
                       h.EMPCODE, h."ATDTCARD#"
                FROM HR_EMP_MASTER h
                LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
                WHERE h."MOBILE#" IN (:l1, :l2, :l3)
                   OR h."ATDTCARD#" = :l4 OR h.EMPCODE = :l5
            """, {"l1": l, "l2": l_w0, "l3": l_no0, "l4": l, "l5": l})
            row = cur.fetchone()
            if row:
                card_no      = str(row[0]) if row[0] else (str(row[4]) if row[4] else None)
                stored_paswd = (row[1] or "").strip()
                if stored_paswd and stored_paswd != password.strip():
                    print(f"[AUTH] HR_EMP_MASTER: password mismatch for {username}")
                    return None
                print(f"[AUTH] HR_EMP_MASTER login: card_no={card_no}, emp_name={row[2]}")
                return {
                    "card_no": card_no,
                    "user_paswd": row[1],
                    "emp_name": str(row[2] or "").strip(),
                    "hr_admin": "N",  # Never Y for HR_EMP_MASTER users
                    "face_registered": "N",
                    "empcode": str(row[3] or "").strip(),
                    "allowed_companies": [],  # No company rights
                    "allowed_branches": [],   # No branch rights
                    "company_list": [],
                    "branch_list": [],
                    "has_self_service": True,
                    "has_employee_features": True,  # Can access employee modules
                }
        except Exception as e:
            print(f"[AUTH] HR_EMP_MASTER query failed: {e}")

        # Fallback: EMPLOYEE table
        try:
            cur.execute("""
                SELECT TO_CHAR(CARD_NO), USER_PASWD FROM EMPLOYEE
                WHERE TO_CHAR(CARD_NO) = :e1 OR EMPCODE = :e2
            """, {"e1": l, "e2": l})
            row = cur.fetchone()
            if row:
                stored_paswd = (row[1] or "").strip()
                if stored_paswd and stored_paswd != password.strip():
                    return None
                return {
                    "card_no": str(row[0]) if row[0] else l,
                    "user_paswd": row[1],
                    "emp_name": "",
                    "hr_admin": "N",
                    "face_registered": "N",
                    "empcode": "",
                    "allowed_companies": [],
                    "allowed_branches": [],
                    "company_list": [],
                    "branch_list": [],
                    "has_self_service": True,
                    "has_employee_features": True,
                }
        except Exception as e:
            print(f"[AUTH] EMPLOYEE fallback failed: {e}")

        print(f"[AUTH] No match for '{username}'")
        return None
    finally:
        cur.close()
        conn.close()


# ===============================
# AUTH — LEGACY LOOKUP
# ===============================

def get_user_by_login(login: str):
    """Find employee by searching HR_EMP_MASTER (has USER_PASWD, HR_ADMIN)
    and EMPLOYEE tables. HR_EMP_MASTER is the primary source for auth fields.
    """
    conn = get_connection()
    cursor = conn.cursor()
    try:
        print(f"[LOGIN] Searching for: '{login}'")

        # ---- Try HR_EMP_MASTER + EMPLOYEE join to get real CARD_NO ----
        try:
            cursor.execute("""
                SELECT TO_CHAR(e.CARD_NO), h.USER_PASWD, h.NAME,
                       NVL(h.HR_ADMIN, 'N') AS hr_admin, h.EMPCODE,
                       h."ATDTCARD#"
                FROM HR_EMP_MASTER h
                LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
                WHERE h."MOBILE#" = :login
                   OR h."MOBILE#" = '0' || :login
                   OR h."ATDTCARD#" = :login
                   OR h.EMPCODE = :login
            """, {"login": login})
            row = cursor.fetchone()
            if row:
                # Prefer EMPLOYEE.CARD_NO (row[0]), fallback to ATDTCARD# (row[5])
                card_no = str(row[0]) if row[0] else (str(row[5]) if row[5] else None)
                has_pwd = bool(row[1])
                print(f"[LOGIN] Found in HR_EMP_MASTER: card_no={card_no}, "
                      f"atdtcard={row[5]}, has_password={has_pwd}, hr_admin={row[3]}")
                return {
                    "card_no": card_no,
                    "user_paswd": row[1],
                    "emp_name": row[2] or "",
                    "hr_admin": str(row[3] or "N").strip().upper(),
                    "empcode": row[4] or "",
                }
        except Exception as e:
            print(f"[LOGIN] HR_EMP_MASTER query failed: {e}")

        # ---- Fallback to EMPLOYEE table ----
        cursor2 = conn.cursor()
        try:
            cursor2.execute("""
                SELECT card_no, USER_PASWD
                FROM EMPLOYEE
                WHERE MOBILE_NO = :login
                   OR MOBILE_NO = '0' || :login
                   OR TO_CHAR(CARD_NO) = :login
                   OR EMP_NO = :login
                   OR EMPCODE = :login
            """, {"login": login})
            row = cursor2.fetchone()
            if row:
                raw = row[0]
                card_no = str(raw) if raw is not None else None
                has_pwd = bool(row[1])
                print(f"[LOGIN] Found in EMPLOYEE: card_no={card_no}, has_password={has_pwd}")
                return {"card_no": card_no, "user_paswd": row[1]}
        finally:
            cursor2.close()

        print(f"[LOGIN] No employee found for '{login}'")
        return None

    finally:
        cursor.close()
        conn.close()


# Keep old name as alias so change_password still works
def get_user_by_phone(phone: str):
    return get_user_by_login(phone)


def lookup_by_phone(phone: str):
    """Return card_no and employee details for a given phone/empcode/card_no."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # Try HR_EMP_MASTER + EMPLOYEE join to get real CARD_NO and details
        try:
            cursor.execute("""
                SELECT TO_CHAR(e.CARD_NO), h.NAME, h.EMPCODE, h."ATDTCARD#"
                FROM HR_EMP_MASTER h
                LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
                WHERE h."MOBILE#" = :login
                   OR h."MOBILE#" = '0' || :login
                   OR h."ATDTCARD#" = :login
                   OR h.EMPCODE = :login
            """, {"login": phone})
            row = cursor.fetchone()
            if row:
                card_no = str(row[0]) if row[0] else (str(row[3]) if row[3] else None)
                if card_no:
                    return {"card_no": card_no, "emp_name": row[1] or "", "empcode": row[2] or ""}
        except Exception as e:
            print(f"[LOOKUP] HR_EMP_MASTER query failed: {e}")

        # Fallback to EMPLOYEE
        cursor2 = conn.cursor()
        try:
            cursor2.execute("""
                SELECT TO_CHAR(CARD_NO), EMP_NAME, EMPCODE
                FROM EMPLOYEE
                WHERE MOBILE_NO = :login
                   OR MOBILE_NO = '0' || :login
                   OR TO_CHAR(CARD_NO) = :login
                   OR EMPCODE = :login
            """, {"login": phone})
            row = cursor2.fetchone()
            if row:
                card_no = str(row[0]) if row[0] is not None else None
                return {"card_no": card_no, "emp_name": row[1] or "", "empcode": row[2] or ""}
        finally:
            cursor2.close()

        return None
    finally:
        cursor.close()
        conn.close()


# ===============================
# DASHBOARD
# ===============================

def get_dashboard(card_no: str):
    """Return dashboard for an employee. Queries HR_EMP_MASTER (a real base table)
    instead of EMPLOYEE (which is a view whose internal scalar subqueries throw
    ORA-01427 for certain users). All lookups are wrapped in isolated try/except
    so any single failure logs but doesn't crash the endpoint.
    """
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # Step 1: core employee record from HR_EMP_MASTER (real table, no view internals).
        # Join EMPLOYEE only for CARD_NO and a few aux fields. If the EMPLOYEE join
        # itself throws ORA-01427, fall back to HR_EMP_MASTER alone.
        row = None
        columns = []
        try:
            cursor.execute("""
                SELECT
                    h.EMPCODE                    AS emp_pk,
                    TO_CHAR(e.CARD_NO)           AS card_no,
                    h."ATDTCARD#"                AS emp_no,
                    h.NAME                       AS emp_name,
                    TO_CHAR(h.DTOFAPPT, 'YYYY-MM-DD') AS date_of_join,
                    h.NICNO                      AS nic_no,
                    TO_CHAR(h.DESG_CD)           AS designation,
                    TO_CHAR(h.DEPT_NO)           AS department,
                    h.UNIT_ID                    AS compc,
                    h.LOCATION                   AS branch,
                    h.HOD1                       AS hod
                FROM HR_EMP_MASTER h
                LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
                WHERE TO_CHAR(e.CARD_NO) = :card1
                   OR h."ATDTCARD#"      = :card2
                   OR h.EMPCODE          = :card3
                FETCH FIRST 1 ROWS ONLY
            """, {"card1": card_no, "card2": card_no, "card3": card_no})
            row = cursor.fetchone()
            columns = [c[0].lower() for c in cursor.description]
        except Exception as e:
            print(f"[DASHBOARD] HR_EMP_MASTER + EMPLOYEE join failed for {card_no}: {e}")
            # Fallback: HR_EMP_MASTER alone (no EMPLOYEE join at all)
            try:
                cursor.execute("""
                    SELECT
                        h.EMPCODE                    AS emp_pk,
                        h."ATDTCARD#"                AS card_no,
                        h."ATDTCARD#"                AS emp_no,
                        h.NAME                       AS emp_name,
                        TO_CHAR(h.DTOFAPPT, 'YYYY-MM-DD') AS date_of_join,
                        h.NICNO                      AS nic_no,
                        TO_CHAR(h.DESG_CD)           AS designation,
                        TO_CHAR(h.DEPT_NO)           AS department,
                        h.UNIT_ID                    AS compc,
                        h.LOCATION                   AS branch,
                        h.HOD1                       AS hod
                    FROM HR_EMP_MASTER h
                    WHERE h."ATDTCARD#" = :card1 OR h.EMPCODE = :card2
                    FETCH FIRST 1 ROWS ONLY
                """, {"card1": card_no, "card2": card_no})
                row = cursor.fetchone()
                columns = [c[0].lower() for c in cursor.description]
            except Exception as e2:
                print(f"[DASHBOARD] HR_EMP_MASTER fallback also failed for {card_no}: {e2}")
                return None

        if not row:
            return None

        result = dict(zip(columns, row))
        if result.get('card_no') is not None:
            result['card_no'] = str(result['card_no'])
        if result.get('emp_pk') is not None:
            try:
                result['emp_pk'] = float(result['emp_pk'])
            except (ValueError, TypeError):
                result['emp_pk'] = None

        # Isolated name lookups — any failure leaves the field as None
        result['compcnm'] = _safe_lookup_max(
            cursor, "SELECT MAX(DESCR) FROM COMPANY_INFO WHERE COMPC = :v",
            result.get('compc'), tag="compcnm"
        )
        result['brnchnm'] = _safe_lookup_max(
            cursor, "SELECT MAX(DESCR) FROM COM_LOCATION WHERE LCODE = :v",
            result.get('branch'), tag="brnchnm"
        )
        result['hod_nm'] = _safe_lookup_max(
            cursor, "SELECT MAX(NAME) FROM HR_EMP_MASTER WHERE EMPCODE = TO_CHAR(:v)",
            result.get('hod'), tag="hod_nm"
        )

        # Leave balance — isolated, may throw if ALL_LEAVE_BAL_V internals fail
        balance = None
        try:
            cursor.execute(
                "SELECT SUM(balance) FROM ALL_LEAVE_BAL_V WHERE card_no = :c",
                {"c": card_no},
            )
            r = cursor.fetchone()
            balance = float(r[0]) if r and r[0] is not None else None
        except Exception as e:
            print(f"[DASHBOARD] balance lookup failed for {card_no}: {e}")
        result['balance'] = balance

        return result

    finally:
        cursor.close()
        conn.close()


def _safe_lookup_max(cursor, sql: str, value, tag: str = ""):
    """Run a one-row MAX() lookup with a single bind. Returns None if value is None
    or the query fails for any reason. Logs the error tag for diagnostics."""
    if value is None:
        return None
    try:
        cursor.execute(sql, {"v": value})
        r = cursor.fetchone()
        return r[0] if r and r[0] is not None else None
    except Exception as e:
        print(f"[DASHBOARD] {tag} lookup failed for value={value}: {e}")
        return None


# ===============================
# USER PROFILE
# ===============================

def get_user_profile(card_no: str):
    """Return employee profile from HR_EMP_MASTER (primary) + EMPLOYEE (card_no only).
    card_no like '100001.1' lives in EMPLOYEE.CARD_NO (numeric), not in ATDTCARD#.
    Mirror the dashboard pattern: join EMPLOYEE only for TO_CHAR(CARD_NO), fall back
    to ATDTCARD#/EMPCODE match if the join raises ORA-01427."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        row = None
        columns = []
        resolved_card_no = card_no

        # Primary attempt: join EMPLOYEE only to resolve CARD_NO — select no view-computed columns
        try:
            cursor.execute("""
                SELECT
                    h.EMPCODE,
                    h.NAME,
                    h.FHNAME,
                    TO_CHAR(e.CARD_NO)                   AS card_no,
                    h."ATDTCARD#"                        AS atdtcard,
                    h.SEX,
                    TO_CHAR(h.DTOFBRTH, 'YYYY-MM-DD')   AS DTOFBRTH,
                    TO_CHAR(h.DTOFAPPT, 'YYYY-MM-DD')   AS DTOFAPPT,
                    h.DEPT_NO,
                    h.DESG_CD,
                    h."MOBILE#",
                    h.EMAIL,
                    h.ADDRESS,
                    h.UNIT_ID,
                    h.LOCATION,
                    h.HOD1,
                    h.HOD2,
                    h.STATUS,
                    h.NICNO,
                    h.BASIC,
                    h.GRADE_CD,
                    h.MARSTAT
                FROM HR_EMP_MASTER h
                LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
                WHERE TO_CHAR(e.CARD_NO) = :c1
                   OR h."ATDTCARD#"      = :c2
                   OR h.EMPCODE          = :c3
                FETCH FIRST 1 ROWS ONLY
            """, {"c1": card_no, "c2": card_no, "c3": card_no})
            row = cursor.fetchone()
            columns = [c[0].lower() for c in cursor.description]
        except Exception as e:
            print(f"[PROFILE] join attempt failed for {card_no}: {e}")

        # Fallback: HR_EMP_MASTER alone (no EMPLOYEE join)
        if row is None:
            try:
                cursor.execute("""
                    SELECT
                        h.EMPCODE,
                        h.NAME,
                        h.FHNAME,
                        h."ATDTCARD#"                        AS card_no,
                        h."ATDTCARD#"                        AS atdtcard,
                        h.SEX,
                        TO_CHAR(h.DTOFBRTH, 'YYYY-MM-DD')   AS DTOFBRTH,
                        TO_CHAR(h.DTOFAPPT, 'YYYY-MM-DD')   AS DTOFAPPT,
                        h.DEPT_NO,
                        h.DESG_CD,
                        h."MOBILE#",
                        h.EMAIL,
                        h.ADDRESS,
                        h.UNIT_ID,
                        h.LOCATION,
                        h.HOD1,
                        h.HOD2,
                        h.STATUS,
                        h.NICNO,
                        h.BASIC,
                        h.GRADE_CD,
                        h.MARSTAT
                    FROM HR_EMP_MASTER h
                    WHERE h."ATDTCARD#" = :c1 OR h.EMPCODE = :c2
                    FETCH FIRST 1 ROWS ONLY
                """, {"c1": card_no, "c2": card_no})
                row = cursor.fetchone()
                columns = [c[0].lower() for c in cursor.description]
            except Exception as e:
                print(f"[PROFILE] fallback failed for {card_no}: {e}")

        if row is None:
            return None

        raw = dict(zip(columns, row))
        empcode  = raw.get('empcode')
        dept_no  = raw.get('dept_no')
        desg_cd  = raw.get('desg_cd')
        resolved_card_no = raw.get('card_no') or raw.get('atdtcard') or card_no

        result = {
            'emp_pk':        empcode,
            'emp_no':        empcode,
            'emp_code':      empcode,
            'emp_name':      raw.get('name'),
            'father_name':   raw.get('fhname'),
            'card_no':       resolved_card_no,
            'gender':        raw.get('sex'),
            'date_of_birth': raw.get('dtofbrth'),
            'date_of_join':  raw.get('dtofappt'),
            'mobile_no':     raw.get('mobile#'),
            'email':         raw.get('email'),
            'email_address': raw.get('email'),
            'address':       raw.get('address'),
            'compc':         raw.get('unit_id'),
            'brnch':         raw.get('location'),
            'hod1':          raw.get('hod1'),
            'hod2':          raw.get('hod2'),
            'emp_status':    raw.get('status'),
            'nic_no':        raw.get('nicno'),
            'salary':        raw.get('basic'),
            'type':          raw.get('grade_cd'),
            'nic_exp_date':  None,
            'eobi_no':       None,
            'uic_card_no':   None,
        }

        # Isolated name lookups — dept/designation codes are unique PER COMPANY,
        # so they must be resolved with the employee's company (COMPC = UNIT_ID),
        # otherwise the same code resolves to a different company's name.
        _unit = raw.get('unit_id')

        def _name_compc(sql, code, tag):
            if code is None:
                return None
            try:
                cursor.execute(sql, {"v": code, "c": _unit})
                r = cursor.fetchone()
                return r[0] if r and r[0] is not None else None
            except Exception as e:
                print(f"[PROFILE] {tag} lookup failed: {e}")
                return None

        result['department'] = _name_compc(
            "SELECT MAX(DEPT_NAME) FROM HR_DEPT "
            "WHERE LTRIM(DEPT_NO,'0')=LTRIM(:v,'0') AND TO_CHAR(COMPC)=TO_CHAR(:c)",
            dept_no, "profile.department") or str(dept_no or '')
        result['designation'] = _name_compc(
            "SELECT MAX(DESG_DESC) FROM HR_DESG "
            "WHERE LTRIM(DESG_CD,'0')=LTRIM(:v,'0') AND TO_CHAR(COMPC)=TO_CHAR(:c)",
            desg_cd, "profile.designation") or str(desg_cd or '')
        result['compcnm'] = _safe_lookup_max(
            cursor, "SELECT MAX(DESCR) FROM COMPANY_INFO WHERE COMPC = :v",
            result.get('compc'), tag="profile.compcnm"
        )
        result['brnchnm'] = _safe_lookup_max(
            cursor, "SELECT MAX(DESCR) FROM COM_LOCATION WHERE LCODE = :v",
            result.get('brnch'), tag="profile.brnchnm"
        )
        result['hod1nm'] = _safe_lookup_max(
            cursor, "SELECT MAX(NAME) FROM HR_EMP_MASTER WHERE EMPCODE = TO_CHAR(:v)",
            result.get('hod1'), tag="profile.hod1nm"
        )
        result['hod2nm'] = _safe_lookup_max(
            cursor, "SELECT MAX(NAME) FROM HR_EMP_MASTER WHERE EMPCODE = TO_CHAR(:v)",
            result.get('hod2'), tag="profile.hod2nm"
        )

        return result

    finally:
        cursor.close()
        conn.close()


# ===============================
# LEAVE BALANCES
# ===============================

# ===============================
# LEAVE — SHARED HELPERS
# ===============================

_OD_PATTERN = re.compile(
    r'(^OD$|\bOD\b|-\s*OD\b|\bON\s*DUTY\b|\bOFFICIAL\s*DUTY\b|\bOUT\s*DOOR\b|\bOUTDOOR\b)',
    re.IGNORECASE,
)


def _is_od_type(code, desc) -> bool:
    text = f"{code or ''} {desc or ''}"
    return bool(_OD_PATTERN.search(text))


def _card_int_str(card_no: str) -> str:
    """Numeric prefix of a possibly dotted/company-qualified card string."""
    s = (card_no or "").strip()
    return s.split(".")[0] if "." in s else s


def _resolve_leave_employee(card_no: str):
    """Resolve employee identity for leave purposes from EMPLOYEE (unique per
    person via CARD_NO) — never via HR_EMP_MASTER.EMPCODE, which collides across
    units. Falls back to the numeric prefix of a dotted card if no exact match.
    Returns None if nothing resolves — callers must not guess further.
    """
    conn = get_connection()
    cursor = conn.cursor()
    try:
        row = None
        try:
            cursor.execute("""
                SELECT TO_CHAR(CARD_NO), EMP_PK, EMP_NAME, COMPC, BRNCH, HOD1, HOD2, HOD3
                FROM EMPLOYEE
                WHERE TO_CHAR(CARD_NO) = :card
                FETCH FIRST 1 ROWS ONLY
            """, {"card": card_no})
            row = cursor.fetchone()
        except Exception as e:
            print(f"[LEAVE] Employee lookup by card_no failed for {card_no}: {e}")

        if not row:
            card_int = _card_int_str(card_no)
            if card_int and card_int.lstrip("-").isdigit():
                try:
                    cursor.execute("""
                        SELECT TO_CHAR(CARD_NO), EMP_PK, EMP_NAME, COMPC, BRNCH, HOD1, HOD2, HOD3
                        FROM EMPLOYEE
                        WHERE CARD_NO = TO_NUMBER(:card_int)
                        FETCH FIRST 1 ROWS ONLY
                    """, {"card_int": card_int})
                    row = cursor.fetchone()
                except Exception as e:
                    print(f"[LEAVE] Employee lookup by numeric prefix failed for {card_no}: {e}")

        if not row:
            return None

        emp_pk = row[1]
        try:
            emp_pk = float(emp_pk) if emp_pk is not None else None
        except (TypeError, ValueError):
            pass

        return {
            "card_no": row[0],
            "emp_pk": emp_pk,
            "emp_name": (row[2] or "").strip(),
            "compc": row[3],
            "brnch": row[4],
            "hod1": row[5],
            "hod2": row[6],
            "hod3": row[7],
        }
    finally:
        cursor.close()
        conn.close()


def _load_leave_types_meta(cursor):
    """LEAVE_TYPES is the LOV source of truth for 'apply leave'. It carries a
    single global row set (not filtered by COMPC/BRNCH) — the columns on it are
    metadata, not a per-company partition. PK duplicates exist (e.g. 'CL' twice),
    so callers must key on PK for FK inserts, not on code alone.
    """
    cursor.execute("""
        SELECT LEAVE_TYPE_PK, LEAVE_TYPE, LEAVE_DESC, ENTITLEMENT, ALLOWED
        FROM LEAVE_TYPES
        ORDER BY LEAVE_TYPE_PK
    """)
    out = []
    for pk, code, desc, entitlement, allowed in cursor.fetchall():
        code = (code or "").strip()
        desc = (desc or "").strip()
        fallback_days = entitlement if entitlement is not None else allowed
        out.append({
            "pk": pk,
            "code": code,
            "desc": desc,
            "entitlement": float(fallback_days) if fallback_days is not None else 0.0,
            "is_od": _is_od_type(code, desc),
        })
    return out


def _match_leave_type(raw, types_meta):
    """Resolve a client-supplied leave type identifier (code, PK, or description —
    never int()-cast) against LEAVE_TYPES metadata."""
    if raw is None:
        return None
    key = str(raw).strip().upper()
    if not key:
        return None
    for t in types_meta:
        if (t["code"] and t["code"].upper() == key) or (t["desc"] and t["desc"].upper() == key):
            return t
    for t in types_meta:
        if str(t["pk"]) == key:
            return t
    return None


def _fetch_balance_rows(cursor, resolved_card_no):
    """Raw ALL_LEAVE_BAL_V rows for an employee, resolved via numeric card."""
    try:
        cursor.execute("""
            SELECT LEAVE_TYPE_PK, LEAVE_TYPE, LEAVE_DESC, BALANCE
            FROM ALL_LEAVE_BAL_V
            WHERE CARD_NO = TO_NUMBER(:card)
        """, {"card": resolved_card_no})
        return cursor.fetchall()
    except Exception as e:
        print(f"[LEAVE] ALL_LEAVE_BAL_V lookup failed for card={resolved_card_no}: {e}")
        return []


def _match_balance_row(bal_rows, candidates):
    """Match a balance row by either its code OR its description against a
    candidate set — the client's identifier sometimes only lines up via
    description, not code."""
    for pk, code, desc, bal in bal_rows:
        row_candidates = {str(pk), (code or "").strip().upper(), (desc or "").strip().upper()}
        if candidates & row_candidates:
            return float(bal) if bal is not None else 0.0
    return None


# ===============================
# GET LEAVE TYPES (apply-leave dropdown / LOV)
# ===============================

def get_leave_types(card_no: str):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        types_meta = _load_leave_types_meta(cursor)

        emp = _resolve_leave_employee(card_no)
        bal_rows = _fetch_balance_rows(cursor, emp["card_no"]) if emp else []

        results = []
        for t in types_meta:
            candidates = {c for c in (t["code"].upper(), t["desc"].upper(), str(t["pk"])) if c}
            balance = _match_balance_row(bal_rows, candidates)
            if balance is None:
                balance = t["entitlement"]

            results.append({
                "leave_type": t["code"] or str(t["pk"]),
                "leave_type_pk": t["pk"],
                "leave_desc": t["desc"],
                "balance": 999.0 if t["is_od"] else balance,
                "is_od": t["is_od"],
            })

        return results
    finally:
        cursor.close()
        conn.close()


# ===============================
# GET LEAVE BALANCES (dashboard / status display feed)
# ===============================

def get_leave_balances(card_no: str):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        emp = _resolve_leave_employee(card_no)
        resolved_card = emp["card_no"] if emp else _card_int_str(card_no)

        rows = _fetch_balance_rows(cursor, resolved_card)

        return [
            {
                "leave_type": (code or "").strip() or str(pk),
                "leave_type_pk": pk,
                "leave_desc": (desc or "").strip(),
                "balance": float(bal) if bal is not None else 0.0,
                "is_od": _is_od_type(code, desc),
            }
            for pk, code, desc, bal in rows
        ]
    finally:
        cursor.close()
        conn.close()


# ===============================
# APPLY LEAVE (POST)
# ===============================

def apply_leave(card_no: str,
                leave_type_raw: str,
                from_date: str,
                to_date: str,
                reason: str,
                compc,
                brnch,
                emp_name: str,
                half_day: bool = False,
                half_day_session: str = None,
                from_time: str = None,
                to_time: str = None):

    conn = get_connection()
    cursor = conn.cursor()
    try:
        # ---- Half-day handling ----
        if half_day:
            to_date = from_date
            leave_days = 0.5
            hrs = 4
            if from_time and to_time:
                reason = f"{reason} [Half Day: {from_time}-{to_time}]"
            elif (half_day_session or "").strip().lower() == "second":
                reason = f"{reason} [Second Half: 13:00-18:00]"
            else:
                reason = f"{reason} [First Half: 09:30-13:00]"
        else:
            d1 = datetime.strptime(from_date, "%Y-%m-%d")
            d2 = datetime.strptime(to_date, "%Y-%m-%d")
            leave_days = (d2 - d1).days + 1
            hrs = 0

        # ---- Resolve leave type: code, PK, or description — never int()-cast ----
        types_meta = _load_leave_types_meta(cursor)
        resolved_type = _match_leave_type(leave_type_raw, types_meta)
        if not resolved_type:
            return {"status": "error", "message": f"Unknown leave type: {leave_type_raw}"}

        try:
            leave_type_fk = int(resolved_type["pk"])
        except (TypeError, ValueError):
            return {"status": "error", "message": f"Unknown leave type: {leave_type_raw}"}

        is_od = resolved_type["is_od"]

        # ---- Resolve employee (never guess if this fails) ----
        emp = _resolve_leave_employee(card_no)
        if not emp or emp.get("emp_pk") is None:
            return {"status": "error", "message": f"Employee not found for card {card_no}"}

        emp_fk = emp["emp_pk"]
        resolved_name = emp_name or emp.get("emp_name") or ""
        resolved_compc = compc if compc is not None else emp.get("compc")
        resolved_brnch = brnch if brnch is not None else emp.get("brnch")

        # ---- Balance validation (skipped entirely for OD types) ----
        previous_balance = None
        if not is_od:
            bal_rows = _fetch_balance_rows(cursor, emp["card_no"])

            candidates = {c for c in (
                str(leave_type_raw or "").strip().upper(),
                resolved_type["code"].upper(),
                resolved_type["desc"].upper(),
                str(resolved_type["pk"]),
            ) if c}

            current_balance = _match_balance_row(bal_rows, candidates)
            if current_balance is None:
                print(f"[LEAVE] No balance row matched for card={card_no}, type={leave_type_raw}; treating as 0")
                current_balance = 0.0

            previous_balance = current_balance

            if current_balance <= 0:
                return {"status": "error", "message": "No remaining balance for this leave type."}
            if leave_days > current_balance:
                return {
                    "status": "error",
                    "message": f"Insufficient balance. Available: {current_balance}, Requested: {leave_days}",
                }

        # ---- Insert into LEAVE_APPLICATION_APPLY ----
        # LEAVE_APPLICATION_PK has no identity/default — the DB trigger INSERT_LEAVE_PK
        # computes NVL(MAX(...),0)+1 on every insert, which races under concurrent
        # submissions (ORA-00001 on PK_LEAVE) — retry a few times on that specific error.
        year = int(from_date.split("-")[0])
        insert_sql = """
            INSERT INTO LEAVE_APPLICATION_APPLY (
                EMP_FK, LEAVE_TYPE_FK, LEAVE_DATE_FROM, LEAVE_DATE_TO,
                LEAVE_DAYS, HRS, REASON, APPROVAL_STATUS,
                ENTRY_DATE, ENTRY_BY, PREVIOUS_BALANCE, YEAR,
                COMPC, BRNCH, TR_TYPE, HOD1_MNO, HOD2_MNO, HOD3_MNO
            ) VALUES (
                :emp_fk, :leave_type_fk, TO_DATE(:from_date, 'YYYY-MM-DD'), TO_DATE(:to_date, 'YYYY-MM-DD'),
                :leave_days, :hrs, :reason, 'Waiting',
                TO_CHAR(SYSDATE, 'DD-MON-RR HH24:MI', 'NLS_DATE_LANGUAGE=AMERICAN'), :entry_by,
                :previous_balance, :year, :compc, :brnch, 'Online',
                :hod1, :hod2, :hod3
            )
        """
        binds = {
            "emp_fk": emp_fk,
            "leave_type_fk": leave_type_fk,
            "from_date": from_date,
            "to_date": to_date,
            "leave_days": leave_days,
            "hrs": hrs,
            "reason": reason,
            "entry_by": resolved_name,
            "previous_balance": previous_balance,
            "year": year,
            "compc": resolved_compc,
            "brnch": resolved_brnch,
            "hod1": str(emp["hod1"]) if emp.get("hod1") is not None else None,
            "hod2": str(emp["hod2"]) if emp.get("hod2") is not None else None,
            "hod3": str(emp["hod3"]) if emp.get("hod3") is not None else None,
        }

        last_error = None
        for attempt in range(3):
            try:
                cursor.execute(insert_sql, binds)
                conn.commit()
                return {"status": "success"}
            except Exception as e:
                conn.rollback()
                last_error = e
                if "ORA-00001" in str(e) and attempt < 2:
                    time.sleep(0.2 * (attempt + 1))
                    continue
                break

        return {"status": "error", "message": str(last_error)}

    finally:
        cursor.close()
        conn.close()


# Attendance functions moved to repositories/attendance_repository.py


# ===============================
# GET LEAVE STATUS
# ===============================

def get_leave_status(card_no: str):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        types_meta = _load_leave_types_meta(cursor)
        types_by_pk = {str(t["pk"]): t for t in types_meta}

        emp = _resolve_leave_employee(card_no)

        # Match broadly: EMP_FK has been populated inconsistently across entry
        # paths, so try the raw card, its numeric base, the resolved EMPCODE, and
        # the resolved EMP_PK — use whichever the column actually holds.
        candidates = set()
        card_int = _card_int_str(card_no)
        if card_int and card_int.lstrip("-").isdigit():
            candidates.add(card_int)
        if card_no and card_no.strip():
            candidates.add(card_no.strip())
        if emp:
            if emp.get("card_no"):
                candidates.add(str(emp["card_no"]))
            if emp.get("emp_pk") is not None:
                candidates.add(str(emp["emp_pk"]))

        try:
            cursor.execute("""
                SELECT EMPCODE FROM HR_EMP_MASTER
                WHERE "ATDTCARD#" = :c OR EMPCODE = :c
                FETCH FIRST 1 ROWS ONLY
            """, {"c": card_no})
            r = cursor.fetchone()
            if r and r[0]:
                candidates.add(str(r[0]).strip())
        except Exception as e:
            print(f"[LEAVE] HR_EMP_MASTER EMPCODE lookup failed for status, card={card_no}: {e}")

        numeric_candidates = []
        for c in candidates:
            try:
                numeric_candidates.append(float(c))
            except (TypeError, ValueError):
                continue

        if not numeric_candidates:
            return []

        placeholders = ", ".join(f":c{i}" for i in range(len(numeric_candidates)))
        binds = {f"c{i}": v for i, v in enumerate(numeric_candidates)}

        cursor.execute(f"""
            SELECT
                LEAVE_APPLICATION_PK, ENTRY_DATE, LEAVE_TYPE_FK,
                LEAVE_DATE_FROM, LEAVE_DATE_TO, LEAVE_DAYS,
                REASON, APPROVAL_STATUS
            FROM LEAVE_APPLICATION_APPLY
            WHERE EMP_FK IN ({placeholders})
            ORDER BY LEAVE_DATE_FROM DESC, LEAVE_APPLICATION_PK DESC
        """, binds)

        result = []
        for pk, entry_date, leave_type_fk, dfrom, dto, days, reason_, status_ in cursor.fetchall():
            t = types_by_pk.get(str(leave_type_fk)) if leave_type_fk is not None else None
            leave_code = (t["code"] if t and t["code"] else None) or (
                str(leave_type_fk) if leave_type_fk is not None else ""
            )
            result.append({
                "leave_application_pk": pk,
                "entry_date": entry_date,
                "leave_type": str(leave_code),
                "leave_desc": t["desc"] if t else None,
                "from_date": dfrom.strftime("%Y-%m-%d") if hasattr(dfrom, "strftime") else dfrom,
                "to_date": dto.strftime("%Y-%m-%d") if hasattr(dto, "strftime") else dto,
                "leave_days": float(days) if days is not None else None,
                "reason": reason_,
                "status": status_,
            })

        return result

    finally:
        cursor.close()
        conn.close()


# ===============================
# UPDATE PASSWORD
# ===============================

def update_password(card_no: str, new_hash: str):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            UPDATE EMPLOYEE
            SET USER_PASWD = :hash
            WHERE card_no = :card
        """, {"hash": new_hash, "card": card_no})

        conn.commit()

        return {"status": "success", "message": "Password updated"}

    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}

    finally:
        cursor.close()
        conn.close()



# Face attendance, report, and summary functions moved to repositories/attendance_repository.py