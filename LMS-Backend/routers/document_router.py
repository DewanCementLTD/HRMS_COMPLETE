"""Employee document router — /documents/* (HR admin only).

Upload stores the file under EMP_DOCS/Comp{unit}/branch{loc}/{doc_id}.{ext} and
records only the path in HR_DOCUMENT. View/download stream the file back.
"""

import os

from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse

from core.dependencies import require_hr_admin
from repositories.document_repository import (
    list_documents, create_document, get_document, delete_document,
    employee_photo_target, set_employee_photo_path, get_employee_photo_abs,
)

router = APIRouter(prefix="/documents", tags=["Employee Documents"])

# Extensions we allow HR to upload.
ALLOWED_EXT = {"png", "jpg", "jpeg", "gif", "webp", "pdf", "doc", "docx", "xls", "xlsx", "txt"}
PHOTO_EXT = {"png", "jpg", "jpeg", "webp", "gif"}


@router.get("")
def list_employee_documents(empcode: str = Query(...), admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    return {"items": list_documents(empcode)}


@router.post("")
async def upload_document(
    admin_card_no: str = Query(...),
    empcode: str = Form(...),
    d_type: str = Form(""),
    doc_name: str = Form(""),
    remarks: str = Form(""),
    file: UploadFile = File(...),
):
    require_hr_admin(admin_card_no)
    ext = (os.path.splitext(file.filename or "")[1] or "").lstrip(".").lower()
    if ext not in ALLOWED_EXT:
        raise HTTPException(status_code=400, detail=f"File type .{ext or '?'} not allowed")

    info = create_document(empcode, d_type, doc_name, remarks, ext)
    try:
        os.makedirs(info["abs_dir"], exist_ok=True)
        content = await file.read()
        with open(info["abs_path"], "wb") as f:
            f.write(content)
    except Exception as e:
        # File write failed — roll back the DB row so we don't leave an orphan.
        delete_document(info["doc_id"])
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    return {
        "status": "success", "doc_id": info["doc_id"],
        "img_name": info["rel_path"], "message": "Document uploaded",
    }


@router.post("/employee-photo")
async def upload_employee_photo(
    admin_card_no: str = Query(...),
    empcode: str = Query(...),
    file: UploadFile = File(...),
):
    """Upload/replace an employee's profile photo (stored on disk; path saved to
    HR_EMP_MASTER.PATH). Shown on the ID card."""
    require_hr_admin(admin_card_no)
    ext = (os.path.splitext(file.filename or "")[1] or "").lstrip(".").lower()
    if ext not in PHOTO_EXT:
        raise HTTPException(status_code=400, detail="Photo must be an image (png/jpg/webp/gif)")
    t = employee_photo_target(empcode, ext)
    try:
        os.makedirs(t["abs_dir"], exist_ok=True)
        # Remove any previous photo of this employee (other extensions).
        for e in PHOTO_EXT:
            prev = employee_photo_target(empcode, e)["abs_path"]
            if prev != t["abs_path"] and os.path.isfile(prev):
                try:
                    os.remove(prev)
                except OSError:
                    pass
        content = await file.read()
        with open(t["abs_path"], "wb") as f:
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save photo: {e}")
    if not set_employee_photo_path(empcode, t["rel_path"]):
        raise HTTPException(status_code=404, detail="Employee not found")
    return {"status": "success", "path": t["rel_path"]}


@router.get("/employee-photo")
def get_employee_photo(admin_card_no: str = Query(...), empcode: str = Query(...)):
    """Serve an employee's photo (for the form preview / ID card)."""
    require_hr_admin(admin_card_no)
    path = get_employee_photo_abs(empcode)
    if not path:
        raise HTTPException(status_code=404, detail="No photo")
    return FileResponse(path, headers={"Cache-Control": "no-cache"})


@router.get("/{doc_id}/download")
def download_document(doc_id: int, admin_card_no: str = Query(...), inline: bool = Query(False)):
    require_hr_admin(admin_card_no)
    doc = get_document(doc_id)
    if not doc or not doc.get("abs_path") or not os.path.isfile(doc["abs_path"]):
        raise HTTPException(status_code=404, detail="Document file not found")
    fname = os.path.basename(doc["abs_path"])
    disposition = "inline" if inline else "attachment"
    return FileResponse(
        doc["abs_path"],
        filename=fname,
        headers={"Content-Disposition": f'{disposition}; filename="{fname}"'},
    )


@router.delete("/{doc_id}")
def remove_document(doc_id: int, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    result = delete_document(doc_id)
    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return {"status": "success", "message": "Document deleted"}
