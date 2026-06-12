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
import re

from core.database import get_connection

# Root directory for all employee documents. Overridable via EMP_DOCS_ROOT.
# Default: C:\Erp_Systems\HRMS_LMS_APP\EMP_DOCS (sibling of GIT_NEW), so files
# live outside the repo.
DOCS_ROOT = os.environ.get(
    "EMP_DOCS_ROOT",
    r"C:\Erp_Systems\HRMS_LMS_APP\EMP_DOCS",
)
# Parent of EMP_DOCS — relative paths stored in HR_DOCUMENT.IMG_NM resolve against this.
DOCS_BASE = os.path.dirname(DOCS_ROOT)


def _safe_name(name: str, fallback: str) -> str:
    """Make a string safe to use as a folder name: strip filesystem-illegal
    characters, collapse whitespace, trim trailing dots/spaces."""
    s = re.sub(r'[\\/:*?"<>|]+', " ", str(name or "")).strip()
    s = re.sub(r"\s+", " ", s).strip(" .")
    return s or fallback


def _emp_unit_branch(cursor, empcode: str):
    """Return (unit_id, branch_code, company_folder, branch_folder) for an
    employee. Folder names use the real company/branch names where available,
    falling back to Comp{id}/branch{code}."""
    cursor.execute(
        "SELECT NVL(UNIT_ID, 1), NVL(LOCATION, '0') FROM HR_EMP_MASTER WHERE EMPCODE = :e",
        {"e": empcode},
    )
    r = cursor.fetchone()
    unit = int(r[0]) if r and r[0] is not None else 1
    branch = (str(r[1]).strip() if r and r[1] is not None else "0") or "0"

    company_name = None
    try:
        cursor.execute("SELECT UNIT_NAME FROM UNIT_MST WHERE UNIT_ID = :u", {"u": unit})
        cr = cursor.fetchone()
        company_name = cr[0] if cr else None
    except Exception:
        pass

    branch_name = None
    try:
        cursor.execute("SELECT DESCR FROM COM_LOCATION WHERE LCODE = :l", {"l": branch})
        br = cursor.fetchone()
        branch_name = br[0] if br else None
    except Exception:
        pass

    company_folder = _safe_name(company_name, f"Comp{unit}")
    branch_folder = _safe_name(branch_name, f"branch{branch}")
    return unit, branch, company_folder, branch_folder


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
        unit, branch, company_folder, branch_folder = _emp_unit_branch(cursor, empcode)
        cursor.execute("SELECT NVL(MAX(DOC_ID), 0) + 1 FROM HR_DOCUMENT")
        doc_id = int(cursor.fetchone()[0])

        ext = (ext or "").lstrip(".").lower() or "bin"
        # File name: <empcode>_<doc_id>.<ext>  e.g. 100011.2_5.png
        fname = f"{_safe_name(str(empcode), 'emp')}_{doc_id}.{ext}"
        rel_dir = os.path.join("EMP_DOCS", company_folder, branch_folder)
        rel_path = os.path.join(rel_dir, fname)
        abs_dir = os.path.join(DOCS_BASE, rel_dir)
        abs_path = os.path.join(DOCS_BASE, rel_path)

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
        abs_path = os.path.join(DOCS_BASE, rel) if rel else None
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


# ------------------------------------------------------------------
# EMPLOYEE PHOTO  (stored on disk under EMP_PHOTOS, path in HR_EMP_MASTER.PATH)
# ------------------------------------------------------------------

PHOTO_DIRNAME = "EMP_PHOTOS"


def employee_photo_target(empcode: str, ext: str) -> dict:
    """Return where an employee's photo should be written + the relative path
    to store in HR_EMP_MASTER.PATH."""
    safe = _safe_name(str(empcode), "emp")
    ext = (ext or "").lstrip(".").lower() or "jpg"
    rel = os.path.join(PHOTO_DIRNAME, f"{safe}.{ext}")
    return {
        "rel_path": rel,
        "abs_path": os.path.join(DOCS_BASE, rel),
        "abs_dir": os.path.join(DOCS_BASE, PHOTO_DIRNAME),
    }


def set_employee_photo_path(empcode: str, rel_path: str) -> bool:
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("UPDATE HR_EMP_MASTER SET PATH = :p WHERE EMPCODE = :e",
                       {"p": rel_path, "e": str(empcode)})
        if cursor.rowcount == 0:
            cursor.execute("UPDATE HR_EMP_MASTER SET PATH = :p WHERE OLD_EMPCODE = :e",
                           {"p": rel_path, "e": str(empcode)})
        conn.commit()
        return cursor.rowcount > 0
    finally:
        cursor.close()
        conn.close()


def get_employee_photo_abs(empcode: str) -> str | None:
    """Absolute path to an employee's photo file, or None if not set/missing."""
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT PATH FROM HR_EMP_MASTER WHERE EMPCODE = :e OR OLD_EMPCODE = :e FETCH FIRST 1 ROWS ONLY",
                       {"e": str(empcode)})
        r = cursor.fetchone()
        rel = (r[0] or "").strip() if r else ""
        if not rel:
            return None
        abs_path = rel if os.path.isabs(rel) else os.path.join(DOCS_BASE, rel)
        return abs_path if os.path.isfile(abs_path) else None
    finally:
        cursor.close()
        conn.close()


# ------------------------------------------------------------------
# COMPANY LOGO  (file under COMP_LOGO, path in COMPANY_INFO.IMG)
# ------------------------------------------------------------------

COMP_LOGO_ROOT = os.environ.get("COMP_LOGO_ROOT", r"C:\Erp_Systems\HRMS_LMS_APP\COMP_LOGO")
_LOGO_EXTS = ("png", "jpg", "jpeg", "webp", "gif", "svg")


def _company_descr(cursor, compc) -> str:
    try:
        cursor.execute("SELECT DESCR FROM COMPANY_INFO WHERE TO_CHAR(COMPC) = :c", {"c": str(compc)})
        r = cursor.fetchone()
        return (r[0] or "").strip() if r else ""
    except Exception:
        return ""


def company_logo_target(compc, ext: str) -> dict:
    """Where a company's logo is saved: COMP_LOGO/<CompanyName>_logo.<ext>."""
    conn = get_connection(); cursor = conn.cursor()
    try:
        descr = _company_descr(cursor, compc)
    finally:
        cursor.close(); conn.close()
    safe = _safe_name(descr, f"company{compc}")
    ext = (ext or "png").lstrip(".").lower()
    fname = f"{safe}_logo.{ext}"
    return {"abs_dir": COMP_LOGO_ROOT, "abs_path": os.path.join(COMP_LOGO_ROOT, fname), "filename": fname}


def set_company_logo(compc, abs_path: str) -> bool:
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("UPDATE COMPANY_INFO SET IMG = :p WHERE TO_CHAR(COMPC) = :c",
                       {"p": abs_path, "c": str(compc)})
        conn.commit()
        return cursor.rowcount > 0
    finally:
        cursor.close(); conn.close()


def get_company_logo_abs(compc) -> str | None:
    """Absolute path to a company's logo file. Prefers COMPANY_INFO.IMG when it
    points to an existing file, else looks for <CompanyName>_logo.* in COMP_LOGO."""
    conn = get_connection(); cursor = conn.cursor()
    try:
        cursor.execute("SELECT IMG, DESCR FROM COMPANY_INFO WHERE TO_CHAR(COMPC) = :c", {"c": str(compc)})
        r = cursor.fetchone()
    finally:
        cursor.close(); conn.close()
    img = (r[0] or "").strip() if r else ""
    if img:
        # IMG may be a full path, or a bare filename relative to COMP_LOGO.
        if os.path.isfile(img):
            return img
        cand = os.path.join(COMP_LOGO_ROOT, os.path.basename(img))
        if os.path.isfile(cand):
            return cand
    descr = (r[1] or "").strip() if r else ""
    safe = _safe_name(descr, "")
    if safe:
        for ext in _LOGO_EXTS:
            p = os.path.join(COMP_LOGO_ROOT, f"{safe}_logo.{ext}")
            if os.path.isfile(p):
                return p
    return None
