"""Employee document repository (HR_DOCUMENT).

Files are stored on disk under EMP_DOCS, organised by company and branch:
    EMP_DOCS/Comp{unit_id}/branch{location}/{doc_id}.{ext}
Only the relative path is kept in the DB (HR_DOCUMENT.IMG_NM) — never the bytes.

Column mapping:
    DOC_ID     -> id
    OLD_EMPCODE-> employee identifier (the empcode used by the app)
    UNIT_ID    -> company
    D_TYPE     -> document type
    D_PATH     -> document name
    REMRK      -> remarks
    IMG_NM     -> saved relative file path (the "Image Name" / address)
"""

import os

from core.database import get_connection

# Root directory for all employee documents.
DOCS_ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "EMP_DOCS")


def _emp_unit_branch(cursor, empcode: str):
    """Return (unit_id, location/branch) for an employee, defaulting to (1, 0)."""
    cursor.execute(
        "SELECT NVL(UNIT_ID, 1), NVL(LOCATION, '0') FROM HR_EMP_MASTER WHERE EMPCODE = :e",
        {"e": empcode},
    )
    r = cursor.fetchone()
    if not r:
        return 1, "0"
    unit = int(r[0]) if r[0] is not None else 1
    branch = str(r[1]).strip() if r[1] is not None else "0"
    return unit, (branch or "0")


def list_documents(empcode: str) -> list:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT DOC_ID, D_TYPE, D_PATH, REMRK, IMG_NM
            FROM HR_DOCUMENT
            WHERE OLD_EMPCODE = :e
            ORDER BY DOC_ID DESC
        """, {"e": str(empcode)})
        rows = cursor.fetchall()
        return [{
            "doc_id": int(r[0]),
            "d_type": (r[1] or "").strip(),
            "doc_name": (r[2] or "").strip(),
            "remarks": (r[3] or "").strip(),
            "img_name": (r[4] or "").strip(),
        } for r in rows]
    finally:
        cursor.close()
        conn.close()


def create_document(empcode: str, d_type: str, doc_name: str, remarks: str, ext: str) -> dict:
    """Insert an HR_DOCUMENT row and return where the file should be written.
    Returns {doc_id, rel_path, abs_path, abs_dir}."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        unit, branch = _emp_unit_branch(cursor, empcode)
        cursor.execute("SELECT NVL(MAX(DOC_ID), 0) + 1 FROM HR_DOCUMENT")
        doc_id = int(cursor.fetchone()[0])

        ext = (ext or "").lstrip(".").lower() or "bin"
        rel_dir = os.path.join("EMP_DOCS", f"Comp{unit}", f"branch{branch}")
        rel_path = os.path.join(rel_dir, f"{doc_id}.{ext}")
        abs_dir = os.path.join(os.path.dirname(DOCS_ROOT), rel_dir)
        abs_path = os.path.join(os.path.dirname(DOCS_ROOT), rel_path)

        cursor.execute("""
            INSERT INTO HR_DOCUMENT (DOC_ID, OLD_EMPCODE, UNIT_ID, D_TYPE, D_PATH, REMRK, IMG_NM)
            VALUES (:id, :e, :u, :t, :p, :r, :img)
        """, {
            "id": doc_id, "e": str(empcode), "u": unit,
            "t": (d_type or "")[:10], "p": (doc_name or "")[:500],
            "r": (remarks or "")[:500], "img": rel_path[:500],
        })
        conn.commit()
        return {"doc_id": doc_id, "rel_path": rel_path, "abs_path": abs_path, "abs_dir": abs_dir}
    finally:
        cursor.close()
        conn.close()


def get_document(doc_id: int) -> dict | None:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT DOC_ID, OLD_EMPCODE, D_TYPE, D_PATH, REMRK, IMG_NM
            FROM HR_DOCUMENT WHERE DOC_ID = :id
        """, {"id": doc_id})
        r = cursor.fetchone()
        if not r:
            return None
        rel = (r[5] or "").strip()
        abs_path = os.path.join(os.path.dirname(DOCS_ROOT), rel) if rel else None
        return {
            "doc_id": int(r[0]), "empcode": (r[1] or "").strip(),
            "d_type": (r[2] or "").strip(), "doc_name": (r[3] or "").strip(),
            "remarks": (r[4] or "").strip(), "img_name": rel, "abs_path": abs_path,
        }
    finally:
        cursor.close()
        conn.close()


def delete_document(doc_id: int) -> dict:
    """Delete the DB row and remove the file from disk (best-effort)."""
    doc = get_document(doc_id)
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("DELETE FROM HR_DOCUMENT WHERE DOC_ID = :id", {"id": doc_id})
        conn.commit()
        if doc and doc.get("abs_path") and os.path.isfile(doc["abs_path"]):
            try:
                os.remove(doc["abs_path"])
            except OSError as e:
                print(f"[DOCS] file remove failed (row deleted): {e}")
        return {"status": "success"}
    except Exception as e:
        conn.rollback()
        return {"status": "error", "message": str(e)}
    finally:
        cursor.close()
        conn.close()
