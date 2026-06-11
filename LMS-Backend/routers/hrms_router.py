"""HRMS router — /hrms/* endpoints for employee management and HR dashboard.

All endpoints require HR_ADMIN access (validated via admin_card_no query param).
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional

from core.database import get_connection
from core.dependencies import require_hr_admin
from models.hrms_models import (
    EmployeeCreateRequest,
    EmployeeUpdateRequest,
    MessageResponse,
)
from repositories.user_repository import get_user_rights, admin_can_edit_salary
from services.hrms_service import (
    register_employee,
    get_employee,
    edit_employee,
    search_employees,
    list_employees,
    get_dashboard,
    get_analytics,
    get_bulk_attendance,
    get_attendance_details,
)

router = APIRouter(prefix="/hrms", tags=["HRMS"])


def _get_admin_rights(admin_card_no: str) -> dict:
    """Look up company/branch rights for the given admin's card_no via SEC_USERNAME.

    If SEC_USERCMPN / SEC_USERBRCH have no entries for this admin (e.g. company was
    never configured), fall back to the admin's own UNIT_ID / LOCATION from
    HR_EMP_MASTER so they are always restricted to at least their own company.
    """
    conn = get_connection()
    cur = conn.cursor()
    mobile = ""
    empcode = ""
    own_unit_id = None
    own_location = None
    try:
        cur.execute("""
            SELECT h."MOBILE#", h.EMPCODE, h.UNIT_ID, h.LOCATION
            FROM HR_EMP_MASTER h
            LEFT JOIN EMPLOYEE e ON e.EMPCODE = h.EMPCODE
            WHERE TO_CHAR(e.CARD_NO) = :cn1
               OR TO_CHAR(h."ATDTCARD#") = :cn2
               OR h.EMPCODE = :cn3
            FETCH FIRST 1 ROWS ONLY
        """, {"cn1": admin_card_no, "cn2": admin_card_no, "cn3": admin_card_no})
        row = cur.fetchone()
        if row:
            mobile       = str(row[0] or "").strip()
            empcode      = str(row[1] or "").strip()
            own_unit_id  = str(row[2]).strip() if row[2] is not None else None
            own_location = str(row[3]).strip() if row[3] is not None else None
        else:
            mobile = admin_card_no
    except Exception as e:
        print(f"[_get_admin_rights] lookup failed: {e}")
        mobile = admin_card_no
    finally:
        cur.close()
        conn.close()

    rights = get_user_rights(mobile, empcode)
    allowed_c = rights.get("allowed_companies", [])
    allowed_b = rights.get("allowed_branches",  [])

    # Security fallback: if SEC_USERCMPN has no rows for this admin, restrict to
    # their own company/branch from HR_EMP_MASTER so they cannot see all data.
    if not allowed_c and own_unit_id:
        allowed_c = [own_unit_id]
    if not allowed_b and own_location:
        allowed_b = [own_location]

    return {
        "allowed_companies": allowed_c,
        "allowed_branches":  allowed_b,
    }


# ===================================
# HR DASHBOARD — today's overview
# ===================================

@router.get("/dashboard")
def hrms_dashboard(
    admin_card_no: str = Query(..., description="Card no of requesting HR admin"),
    date: Optional[str] = Query(None, description="Date to query (YYYY-MM-DD), defaults to today"),
    compc: Optional[str] = Query(None, description="Selected company (UNIT_ID) to filter by"),
    brnch: Optional[str] = Query(None, description="Selected branch (LOCATION) to filter by"),
):
    """Get aggregated HR dashboard stats: present, absent, late, dept breakdown."""
    require_hr_admin(admin_card_no)
    # Enforce the admin's company/branch rights server-side — never trust the raw
    # client compc/brnch params (intersected with SEC_USERCMPN / own UNIT_ID).
    final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
    return get_dashboard(qdate=date, compc=final_c, brnch=final_b)


@router.get("/dashboard/analytics")
def hrms_analytics(
    admin_card_no: str = Query(..., description="Card no of requesting HR admin"),
    date: Optional[str] = Query(None, description="Date to query (YYYY-MM-DD), defaults to today"),
    compc: Optional[str] = Query(None, description="Selected company to filter by"),
    brnch: Optional[str] = Query(None, description="Selected branch to filter by"),
):
    """Chart-ready analytics: daily status (30d), monthly trends (6m), KPIs."""
    require_hr_admin(admin_card_no)
    final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
    return get_analytics(qdate=date, compc=final_c, brnch=final_b)


def _resolve_filter_lists(admin_card_no: str, compc: Optional[str], brnch: Optional[str]):
    """Resolve the company/branch filter lists for an HRMS query.
    - If admin selected a specific compc/brnch in the UI, use just that one (but
      only if it's within their allowed list — otherwise fall back to allowed).
    - If no selection, use the full allowed list from SEC_USERCMPN/SEC_USERBRCH.
    """
    rights = _get_admin_rights(admin_card_no)
    allowed_c = rights["allowed_companies"]
    allowed_b = rights["allowed_branches"]
    final_c = [compc] if compc and (not allowed_c or compc in allowed_c) else allowed_c
    final_b = [brnch] if brnch and (not allowed_b or brnch in allowed_b) else allowed_b
    return final_c, final_b


# ===================================
# LIST ALL EMPLOYEES
# ===================================

@router.get("/employees")
def hrms_list_employees(
    admin_card_no: str = Query(..., description="Card no of requesting HR admin"),
    status: str = Query(None, description="Filter by status: A=Active, I=Inactive, L=Left"),
    compc: Optional[str] = Query(None, description="Selected company (UNIT_ID) to filter by"),
    brnch: Optional[str] = Query(None, description="Selected branch (LOCATION) to filter by"),
):
    """Return all employees, optionally filtered by status + selected company/branch."""
    require_hr_admin(admin_card_no)
    final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
    return {"items": list_employees(status, final_c, final_b)}


# ===================================
# SEARCH EMPLOYEES
# ===================================

@router.get("/employees/search")
def hrms_search(
    q: str = Query(..., min_length=1, description="Search term"),
    admin_card_no: str = Query(..., description="Card no of requesting HR admin"),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    require_hr_admin(admin_card_no)
    final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
    results = search_employees(q, final_c, final_b)
    return {"items": results}


# ===================================
# GET EMPLOYEE DETAIL
# ===================================

@router.get("/employees/{empcode}")
def hrms_get_employee(
    empcode: str,
    admin_card_no: str = Query(..., description="Card no of requesting HR admin"),
):
    require_hr_admin(admin_card_no)
    emp = get_employee(empcode)
    if not emp:
        raise HTTPException(status_code=404, detail="Employee not found")
    return emp


@router.get("/employees/{empcode}/card")
def hrms_get_employee_card(
    empcode: str,
    admin_card_no: str = Query(..., description="Card no of requesting HR admin"),
):
    """Printable ID-card data (names resolved) for one employee."""
    require_hr_admin(admin_card_no)
    from repositories.hrms_repository import get_employee_card
    card = get_employee_card(empcode)
    if not card:
        raise HTTPException(status_code=404, detail="Employee not found")
    return card


# ===================================
# REGISTER NEW EMPLOYEE
# ===================================

@router.post("/employees", response_model=MessageResponse)
def hrms_create_employee(
    request: EmployeeCreateRequest,
    admin_card_no: str = Query(..., description="Card no of requesting HR admin"),
):
    require_hr_admin(admin_card_no)

    if not request.name or not request.name.strip():
        raise HTTPException(status_code=400, detail="Employee name is required")

    data = request.model_dump()
    # Only ULEVL='M' users may set basic/gross salary.
    if not admin_can_edit_salary(admin_card_no):
        data.pop("basic", None); data.pop("gross", None)
    result = register_employee(data)

    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("message", "Registration failed"))

    return MessageResponse(
        status="success",
        message=f"Employee registered successfully with EMPCODE: {result['empcode']}",
        empcode=result.get("empcode"),
    )


# ===================================
# UPDATE EMPLOYEE
# ===================================

@router.put("/employees/{empcode}", response_model=MessageResponse)
def hrms_update_employee(
    empcode: str,
    request: EmployeeUpdateRequest,
    admin_card_no: str = Query(..., description="Card no of requesting HR admin"),
):
    require_hr_admin(admin_card_no)

    existing = get_employee(empcode)
    if not existing:
        raise HTTPException(status_code=404, detail="Employee not found")

    data = request.model_dump(exclude_none=True)
    # Only ULEVL='M' users may change basic/gross salary.
    if not admin_can_edit_salary(admin_card_no):
        data.pop("basic", None); data.pop("gross", None)
    result = edit_employee(empcode, data)

    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result.get("message", "Update failed"))

    return MessageResponse(
        status="success",
        message=result.get("message", "Employee updated successfully"),
    )


# ===================================
# BULK ATTENDANCE REPORT
# ===================================

@router.get("/attendance/bulk")
def hrms_bulk_attendance(
    admin_card_no: str = Query(..., description="Card no of requesting HR admin"),
    from_date: str = Query(..., description="Start date YYYY-MM-DD"),
    to_date: str = Query(..., description="End date YYYY-MM-DD"),
    compc: Optional[str] = Query(None, description="Selected company (UNIT_ID) to filter by"),
    brnch: Optional[str] = Query(None, description="Selected branch (LOCATION) to filter by"),
):
    """Return aggregated attendance stats for all active employees in the date range."""
    require_hr_admin(admin_card_no)
    final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
    items = get_bulk_attendance(from_date, to_date, final_c, final_b)
    return {"items": items, "from_date": from_date, "to_date": to_date}


# ===================================
# ATTENDANCE DETAIL RECORDS
# ===================================

@router.get("/attendance/details")
def hrms_attendance_details(
    admin_card_no: str = Query(..., description="Card no of requesting HR admin"),
    from_date: str = Query(..., description="Start date YYYY-MM-DD"),
    to_date: str = Query(..., description="End date YYYY-MM-DD"),
    compc: Optional[str] = Query(None, description="Selected company (UNIT_ID) to filter by"),
    brnch: Optional[str] = Query(None, description="Selected branch (LOCATION) to filter by"),
):
    """Return one row per employee per present day — matches attendance_sheet_for_upload.csv format."""
    require_hr_admin(admin_card_no)
    final_c, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
    items = get_attendance_details(from_date, to_date, final_c, final_b)
    return {"items": items, "from_date": from_date, "to_date": to_date}
