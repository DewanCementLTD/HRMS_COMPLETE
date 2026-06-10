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
)

router = APIRouter(prefix="/documents", tags=["Employee Documents"])

# Extensions we allow HR to upload.
ALLOWED_EXT = {"png", "jpg", "jpeg", "gif", "webp", "pdf", "doc", "docx", "xls", "xlsx", "txt"}


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
