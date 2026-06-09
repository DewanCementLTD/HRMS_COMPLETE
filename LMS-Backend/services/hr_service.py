"""HR service — employee search, face enrollment (HR-only)."""

from core.database import get_connection
from services.face_service import register_face


def search_employees(query: str) -> list:
    """Search employees by name, phone, card number, or empcode."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        like = f"%{query.upper()}%"
        cursor.execute("""
            SELECT
                TO_CHAR(e.CARD_NO)              AS card_no,
                e.EMP_NAME,
                e.DEPARTMENT,
                e.DESIGNATION,
                NVL(e.FACE_REGISTERED, 'N')     AS face_registered,
                e.MOBILE_NO,
                e.EMPCODE
            FROM EMPLOYEE e
            LEFT JOIN HR_EMP_MASTER h ON e.EMPCODE = h.EMPCODE
            WHERE UPPER(e.EMP_NAME) LIKE :q
               OR e.MOBILE_NO LIKE :q
               OR TO_CHAR(e.CARD_NO) LIKE :q
               OR UPPER(e.EMPCODE) LIKE :q
            ORDER BY e.EMP_NAME
            FETCH FIRST 50 ROWS ONLY
        """, {"q": like})

        rows = cursor.fetchall()
        columns = [col[0].lower() for col in cursor.description]
        return [dict(zip(columns, r)) for r in rows]
    finally:
        cursor.close()
        conn.close()


def hr_enroll_face(card_no: str, frames: list, created_at: str = None) -> dict:
    """HR enrolls face for an employee (same as register, but HR-initiated)."""
    return register_face(card_no, frames, created_at)
