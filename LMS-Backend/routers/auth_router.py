"""Auth router — login, dashboard, leave, profile, change-password.
Attendance routes moved to attendance_router.py.
"""

from fastapi import APIRouter, HTTPException

from models.auth_models import (
    LoginRequest,
    LoginResponse,
    DashboardResponse,
    LeaveApplyRequest,
    ProfileResponse,
    ChangePasswordRequest,
    MessageResponse,
)

from services.auth_service import (
    login_user,
    fetch_dashboard,
    fetch_leave_balances,
    fetch_profile,
    apply_leave_service,
    fetch_leave_status,
    change_password,
)
from repositories.user_repository import lookup_by_phone

router = APIRouter(prefix="/auth", tags=["Authentication"])


# ===================================
# LOGIN
# ===================================

@router.post("/login", response_model=LoginResponse)
def login(request: LoginRequest):
    try:
        user = login_user(request.username, request.password)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Login error: {e}")

    if not user:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return LoginResponse(
        status="SUCCESS",
        card_no=user["card_no"],
        emp_name=user.get("emp_name", ""),
        face_registered=user.get("face_registered", "N") == "Y",
        hr_admin=user.get("hr_admin", "N") == "Y",
        has_self_service=user.get("has_self_service", True),
        has_employee_features=user.get("has_employee_features", True),
        allowed_companies=user.get("allowed_companies", []),
        allowed_branches=user.get("allowed_branches", []),
        company_list=user.get("company_list", []),
        branch_list=user.get("branch_list", []),
    )


# ===================================
# DASHBOARD
# ===================================

@router.get("/dashboard/{card_no}", response_model=DashboardResponse)
def dashboard(card_no: str):
    try:
        data = fetch_dashboard(card_no)
        if not data:
            raise HTTPException(status_code=404, detail="User not found")
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ===================================
# LEAVE BALANCES
# ===================================

@router.get("/leave-balances/{card_no}")
def leave_balances(card_no: str):
    try:
        items = fetch_leave_balances(card_no)
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ===================================
# APPLY LEAVE
# ===================================

@router.post("/apply-leave/{card_no}",
             response_model=MessageResponse)
def apply_leave(card_no: str, request: LeaveApplyRequest):

    result = apply_leave_service(
        card_no,
        request.leave_type_id or 0,
        request.from_date,
        request.to_date,
        request.reason,
        request.compc,
        request.brnch,
        request.emp_name,
    )

    if result["status"] == "error":
        raise HTTPException(status_code=400,
                            detail=result["message"])

    return MessageResponse(status=result["status"],
                           message=result.get("message", "Leave applied successfully"))


# ===================================
# LEAVE STATUS
# ===================================

@router.get("/leave-status/{card_no}")
def leave_status(card_no: str):
    try:
        items = fetch_leave_status(card_no)
        return {"items": items}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ===================================
# PROFILE
# ===================================

@router.get("/profile/{card_no}",
            response_model=ProfileResponse)
def profile(card_no: str):
    data = fetch_profile(card_no)

    if not data:
        raise HTTPException(status_code=404,
                            detail="User not found")

    return data


# ===================================
# CHANGE PASSWORD
# ===================================

@router.post("/change-password/{card_no}",
             response_model=MessageResponse)
def update_password_endpoint(card_no: str,
                             request: ChangePasswordRequest):

    success = change_password(
        card_no,
        request.old_password,
        request.new_password
    )

    if not success:
        raise HTTPException(status_code=400,
                            detail="Invalid old password")

    return MessageResponse(
        status="SUCCESS",
        message="Password changed successfully"
    )


# ===================================
# PHONE LOOKUP (no auth required)
# ===================================

@router.get("/lookup/{phone}")
def lookup_employee(phone: str):
    result = lookup_by_phone(phone)
    if not result:
        raise HTTPException(status_code=404, detail="Employee not found")
    return result
