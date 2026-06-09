"""Face authentication router — /face/* endpoints.

Matches the Flutter FaceRemoteDataSourceImpl which calls:
  POST /face/register
  POST /face/verify
  GET  /face/status/{card_no}
"""

from fastapi import APIRouter, HTTPException

from models.face_models import FaceRegisterRequest, FaceVerifyRequest, FaceIdentifyRequest
from services.face_service import register_face, verify_face, check_face_status, identify_face, delete_face

router = APIRouter(prefix="/face", tags=["Face Authentication"])


@router.post("/register")
def face_register(request: FaceRegisterRequest):
    if len(request.frames) < 10:
        raise HTTPException(
            status_code=400,
            detail="Minimum 10 frames required",
        )
    result = register_face(request.card_no, request.frames, request.created_at)
    # Flutter expects response either flat or wrapped in "body"
    return {
        "body": {
            "status": result["status"],
            "card_no": result["card_no"],
            "already_registered": result.get("already_registered", False),
            "msg": result.get("msg", ""),
        }
    }


@router.post("/verify")
def face_verify(request: FaceVerifyRequest):
    if len(request.frames) < 5:
        raise HTTPException(
            status_code=400,
            detail="Minimum 5 frames required",
        )
    result = verify_face(request.card_no, request.frames)
    return {
        "body": {
            "is_match": result["is_match"],
            "confidence": result["confidence"],
            "message": result.get("message", ""),
        }
    }


@router.post("/identify")
def face_identify(request: FaceIdentifyRequest):
    if len(request.frames) < 5:
        raise HTTPException(
            status_code=400,
            detail="Minimum 5 frames required",
        )
    result = identify_face(request.frames)
    return {
        "body": {
            "identified": result["identified"],
            "card_no": result.get("card_no"),
            "emp_name": result.get("emp_name"),
            "confidence": result.get("confidence", 0.0),
            "message": result.get("message", ""),
        }
    }


@router.get("/status/{card_no}")
def face_status(card_no: str):
    result = check_face_status(card_no)
    return {
        "body": {
            "is_registered": result["is_registered"],
            "has_registered": result["is_registered"],
            "has_face": result["is_registered"],
            "card_no": card_no,
            "registered_at": result.get("registered_at"),
        }
    }


@router.delete("/delete/{card_no}")
def face_delete(card_no: str):
    result = delete_face(card_no)
    return {
        "body": {
            "status": result["status"],
            "deleted": result["deleted"],
            "msg": result["msg"],
            "card_no": card_no,
        }
    }
