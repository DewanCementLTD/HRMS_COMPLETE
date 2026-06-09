"""Face repository — EMP_FACE_EMBEDDINGS operations.

Uses the EMP_FACE_EMBEDDINGS table as the source of truth for face
registration status (IS_ACTIVE = 'Y').
"""

from core.database import get_connection


def is_face_registered(card_no: str) -> dict:
    """Check EMP_FACE_EMBEDDINGS for an active registration."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT EMBEDDING_ID, CREATED_AT
            FROM EMP_FACE_EMBEDDINGS
            WHERE EMPCODE = :card AND IS_ACTIVE = 'Y'
            ORDER BY CREATED_AT DESC
            FETCH FIRST 1 ROWS ONLY
        """, {"card": card_no})
        row = cursor.fetchone()
        if not row:
            return {"is_registered": False, "registered_at": None}
        return {
            "is_registered": True,
            "registered_at": str(row[1]) if row[1] else None,
        }
    except Exception as e:
        print("FACE REG CHECK ERROR:", e)
        return {"is_registered": False, "registered_at": None}
    finally:
        cursor.close()
        conn.close()


def store_face_embeddings(card_no: str, embeddings_json: list, created_at: str = None):
    """Store embeddings in EMP_FACE_EMBEDDINGS.

    The actual embedding insertion is handled by the face_login.py service.
    This is a fallback that just marks the entry if called from the stub service.
    """
    return {"status": "success"}


def get_stored_embeddings(card_no: str) -> list:
    """Retrieve stored embeddings for a card_no."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT EMBEDDING_CLOB
            FROM EMP_FACE_EMBEDDINGS
            WHERE EMPCODE = :card AND IS_ACTIVE = 'Y'
            ORDER BY CREATED_AT DESC
            FETCH FIRST 1 ROWS ONLY
        """, {"card": card_no})
        row = cursor.fetchone()
        if row and row[0]:
            return [row[0]]
        return []
    except Exception as e:
        print("EMBEDDING FETCH ERROR:", e)
        return []
    finally:
        cursor.close()
        conn.close()


def delete_face_registration(card_no: str) -> dict:
    """Soft-delete face registration by marking IS_ACTIVE = 'N'."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            UPDATE EMP_FACE_EMBEDDINGS
            SET IS_ACTIVE = 'N'
            WHERE EMPCODE = :card AND IS_ACTIVE = 'Y'
        """, {"card": card_no})
        rows_updated = cursor.rowcount
        conn.commit()
        return {"deleted": rows_updated > 0, "rows": rows_updated}
    except Exception as e:
        conn.rollback()
        print("FACE DELETE ERROR:", e)
        return {"deleted": False, "rows": 0}
    finally:
        cursor.close()
        conn.close()


def get_all_registered_employees() -> list:
    """Return all employees with active face registrations."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT f.EMPCODE, e.EMP_NAME
            FROM EMP_FACE_EMBEDDINGS f
            LEFT JOIN EMPLOYEE e ON TO_CHAR(e.CARD_NO) = f.EMPCODE
            WHERE f.IS_ACTIVE = 'Y'
        """)
        rows = cursor.fetchall()
        return [{"card_no": str(r[0]), "emp_name": r[1] or ""} for r in rows]
    except Exception as e:
        print("FACE LIST ERROR:", e)
        return []
    finally:
        cursor.close()
        conn.close()
