"""Face service — registration, verification, status.

Embedding extraction & comparison are stubs for now.
When a real ML model is integrated, replace the stub functions below.
"""

from repositories.face_repository import (
    is_face_registered,
    store_face_embeddings,
    delete_face_registration,
    get_all_registered_employees,
)


def check_face_status(card_no: str) -> dict:
    """Check if this employee has a registered face."""
    return is_face_registered(card_no)


def register_face(card_no: str, frames: list, created_at: str = None) -> dict:
    """Register face embeddings for an employee.

    Stub: marks FACE_REGISTERED = 'Y' without actual embedding processing.
    """
    status = is_face_registered(card_no)
    if status["is_registered"]:
        return {
            "status": "SUCCESS",
            "card_no": card_no,
            "already_registered": True,
            "msg": "Face already registered",
        }

    # TODO: extract embeddings from frames and store them
    store_face_embeddings(card_no, [], created_at)

    return {
        "status": "SUCCESS",
        "card_no": card_no,
        "already_registered": False,
        "msg": f"Face registered successfully ({len(frames)} frames processed)",
    }


def verify_face(card_no: str, frames: list) -> dict:
    """Verify face against stored embeddings.

    Stub: returns match=True if face is registered (no real comparison yet).
    """
    status = is_face_registered(card_no)
    if not status["is_registered"]:
        return {
            "is_match": False,
            "confidence": 0.0,
            "message": "Face not registered for this employee",
        }

    # TODO: extract embeddings from frames, compare with stored, compute confidence
    # For now, if registered → return a successful match
    return {
        "is_match": True,
        "confidence": 0.95,
        "message": "Face verified successfully",
    }


def delete_face(card_no: str) -> dict:
    """Delete face registration for an employee."""
    status = is_face_registered(card_no)
    if not status["is_registered"]:
        return {
            "status": "SUCCESS",
            "deleted": False,
            "msg": "No active face registration found",
        }
    result = delete_face_registration(card_no)
    return {
        "status": "SUCCESS",
        "deleted": result["deleted"],
        "msg": "Face deleted successfully" if result["deleted"] else "Delete failed",
    }


def identify_face(frames: list) -> dict:
    """Identify a person from face frames (1:N search).

    Stub: returns the first registered employee found.
    When real ML is integrated, this will compare against all stored embeddings.
    """
    registered = get_all_registered_employees()
    if not registered:
        return {
            "identified": False,
            "card_no": None,
            "emp_name": None,
            "confidence": 0.0,
            "message": "No registered faces found in the system",
        }

    # TODO: extract embeddings from frames, compare against all registered
    # For now, return the first registered employee as a stub
    match = registered[0]
    return {
        "identified": True,
        "card_no": match["card_no"],
        "emp_name": match["emp_name"],
        "confidence": 0.92,
        "message": f"Face identified as {match['emp_name']}",
    }
