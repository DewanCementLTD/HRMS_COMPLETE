from fastapi import HTTPException
from core.database import get_connection


_DEFAULT = {
    "emp_name": "",
    "face_registered": "N",
    "hr_admin": "N",
    "empcode": "",
}


def get_employee_flags(card_no: str) -> dict:
    """Fetch emp_name, face_registered, hr_admin for a given card_no.

    HR_ADMIN comes from HR_EMP_MASTER table (linked via EMPCODE or ATDTCARD#).
    FACE_REGISTERED comes from EMPLOYEE table (may not exist yet).

    Cascading fallback:
      1. Full query (EMPLOYEE + HR_EMP_MASTER + FACE_REGISTERED)
      2. Without FACE_REGISTERED but WITH HR_EMP_MASTER  (ORA-00904)
      3. HR_EMP_MASTER only via ATDTCARD# = card_no
      4. EMPLOYEE only                                    (ORA-00942)
    """
    conn = get_connection()
    cursor = conn.cursor()
    try:
        # ---- Attempt 1: EMPLOYEE + HR_EMP_MASTER (no FACE_REGISTERED) ----
        try:
            cursor.execute("""
                SELECT e.EMP_NAME,
                       NVL(h.HR_ADMIN, 'N') AS hr_admin,
                       e.EMPCODE
                FROM EMPLOYEE e
                LEFT JOIN HR_EMP_MASTER h ON e.EMPCODE = h.EMPCODE
                WHERE TO_CHAR(e.CARD_NO) = :card
            """, {"card": card_no})
            row = cursor.fetchone()
            if row:
                return {
                    "emp_name": row[0] or "",
                    "face_registered": "N",
                    "hr_admin": row[1] or "N",
                    "empcode": row[2] or "",
                }
            # No row — fall through to try HR_EMP_MASTER directly
        except Exception as e1:
            err1 = str(e1)
            print(f"[get_employee_flags] Attempt 1 failed: {err1}")
            if "ORA-00904" not in err1 and "ORA-00942" not in err1:
                raise

        # ---- Attempt 3: HR_EMP_MASTER only (via ATDTCARD# = card_no) ----
        cursor3 = conn.cursor()
        try:
            cursor3.execute("""
                SELECT NAME,
                       NVL(HR_ADMIN, 'N') AS hr_admin,
                       EMPCODE
                FROM HR_EMP_MASTER
                WHERE "ATDTCARD#" = :card
                   OR EMPCODE = :card
            """, {"card": card_no})
            row = cursor3.fetchone()
            if row:
                return {
                    "emp_name": row[0] or "",
                    "face_registered": "N",
                    "hr_admin": row[1] or "N",
                    "empcode": row[2] or "",
                }
        except Exception as e3:
            print(f"[get_employee_flags] Attempt 3 (HR_EMP_MASTER direct) failed: {e3}")
        finally:
            cursor3.close()

        # ---- Attempt 4: EMPLOYEE only ----
        cursor4 = conn.cursor()
        try:
            cursor4.execute("""
                SELECT EMP_NAME, EMPCODE
                FROM EMPLOYEE
                WHERE TO_CHAR(CARD_NO) = :card
            """, {"card": card_no})
            row = cursor4.fetchone()
            if not row:
                return dict(_DEFAULT)
            return {
                "emp_name": row[0] or "",
                "face_registered": "N",
                "hr_admin": "N",
                "empcode": row[1] or "",
            }
        finally:
            cursor4.close()

    finally:
        cursor.close()
        conn.close()


def _card_is_sec_username(card_no: str, empcode: str = "") -> bool:
    """Return True if this card_no belongs to an active SEC_USERNAME account.

    Handles two cases:
    - card_no is from EMPLOYEE table → resolve mobile/empcode via HR_EMP_MASTER
    - card_no is the mobile/username itself (SEC_USERNAME user with no employee record)
    """
    conn = get_connection()
    cur = conn.cursor()
    try:
        mobile = ""
        ec = empcode
        try:
            cur.execute("""
                SELECT h."MOBILE#", h.EMPCODE
                FROM HR_EMP_MASTER h
                LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
                WHERE TO_CHAR(e.CARD_NO) = :cn1
                   OR TO_CHAR(h."ATDTCARD#") = :cn2
                   OR h.EMPCODE = :cn3
                FETCH FIRST 1 ROWS ONLY
            """, {"cn1": card_no, "cn2": card_no, "cn3": card_no})
            row = cur.fetchone()
            if row:
                mobile = str(row[0] or "").strip()
                ec     = str(row[1] or empcode or "").strip()
            else:
                mobile = card_no
        except Exception as lookup_err:
            print(f"[_card_is_sec_username] employee lookup error: {lookup_err}")
            mobile = card_no

        if ec:
            cur.execute("""
                SELECT COUNT(*) FROM SEC_USERNAME
                WHERE ECODE = :ec AND STATS = 'E'
            """, {"ec": ec})
            if (cur.fetchone() or [0])[0] > 0:
                return True

        if mobile:
            m_w   = ('0' + mobile) if not mobile.startswith('0') else mobile
            m_no0 = mobile[1:]     if mobile.startswith('0')     else mobile
            cur.execute("""
                SELECT COUNT(*) FROM SEC_USERNAME
                WHERE TO_CHAR(MOBILE) IN (:sm1, :sm2, :sm3) AND STATS = 'E'
            """, {"sm1": mobile, "sm2": m_w, "sm3": m_no0})
            if (cur.fetchone() or [0])[0] > 0:
                return True

        return False
    except Exception as e:
        print(f"[_card_is_sec_username] error: {e}")
        return False
    finally:
        cur.close()
        conn.close()


def require_hr_admin(card_no: str):
    """Raise 403 if card_no does not belong to an active SEC_USERNAME account.

    Only SEC_USERNAME users have HR module access.
    HR_EMP_MASTER.HR_ADMIN flag is no longer used for this check.
    """
    if _card_is_sec_username(card_no):
        return
    raise HTTPException(status_code=403, detail="HR admin access required")
