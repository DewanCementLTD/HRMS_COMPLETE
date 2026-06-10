"""Reference data router — /reference/* endpoints.

GET endpoints: available to any authenticated user (no admin check needed for reads).
POST endpoints: require HR_ADMIN access.
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from core.dependencies import require_hr_admin
from routers.hrms_router import _resolve_filter_lists
from repositories.reference_repository import (
    get_departments, get_grades, get_designations, get_shifts,
    get_blood_groups, get_cadre, get_units, get_religions, get_reporting_officers,
    get_locations, add_location, update_location,
    add_department, add_grade, add_designation, add_shift,
    add_blood_group, add_cadre, add_unit,
    get_emp_statuses, get_banks, get_bank_branches, get_qualifications,
)

router = APIRouter(prefix="/reference", tags=["Reference Data"])


# ─────────────────────────────────────────────────────────────────
# READ endpoints
# ─────────────────────────────────────────────────────────────────

@router.get("/departments")
def list_departments(compc: Optional[str] = Query(None), brnch: Optional[str] = Query(None)):
    return {"items": get_departments(compc, brnch)}


@router.get("/grades")
def list_grades(compc: Optional[str] = Query(None), brnch: Optional[str] = Query(None)):
    return {"items": get_grades(compc, brnch)}


@router.get("/designations")
def list_designations(
    grade_cd: Optional[str] = Query(None),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    return {"items": get_designations(grade_cd, compc, brnch)}


@router.get("/emp-statuses")
def list_emp_statuses():
    return {"items": get_emp_statuses()}


@router.get("/banks")
def list_banks(compc: Optional[str] = Query(None)):
    return {"items": get_banks(compc)}


@router.get("/bank-branches")
def list_bank_branches(bnkcode: Optional[str] = Query(None)):
    return {"items": get_bank_branches(bnkcode)}


@router.get("/qualifications")
def list_qualifications():
    return {"items": get_qualifications()}


@router.get("/shifts")
def list_shifts(compc: Optional[str] = Query(None), brnch: Optional[str] = Query(None)):
    return {"items": get_shifts(compc, brnch)}


@router.get("/blood-groups")
def list_blood_groups(compc: Optional[str] = Query(None), brnch: Optional[str] = Query(None)):
    return {"items": get_blood_groups(compc, brnch)}


@router.get("/cadre")
def list_cadre(compc: Optional[str] = Query(None), brnch: Optional[str] = Query(None)):
    return {"items": get_cadre(compc, brnch)}


@router.get("/units")
def list_units():
    return {"items": get_units()}


@router.get("/religions")
def list_religions():
    return {"items": get_religions()}


@router.get("/reporting-officers")
def list_reporting_officers(compc: Optional[str] = Query(None), brnch: Optional[str] = Query(None)):
    return {"items": get_reporting_officers(compc=compc, brnch=brnch)}


@router.get("/locations")
def list_locations(
    admin_card_no: Optional[str] = Query(None),
    compc: Optional[str] = Query(None),
    brnch: Optional[str] = Query(None),
):
    # Enforce admin's branch rights server-side.
    # COM_LOCATION has no COMPC column — locations ARE branches, so we filter
    # by the admin's allowed branch codes (SEC_USERBRCH.BRNCH = COM_LOCATION.LCODE).
    allowed_branches = None
    if admin_card_no:
        _, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
        if final_b:
            allowed_branches = final_b
    return {"items": get_locations(allowed_branches=allowed_branches)}


# ─────────────────────────────────────────────────────────────────
# ADD endpoints (HR admin only)
# ─────────────────────────────────────────────────────────────────

def _admin_compc_brnch(admin_card_no: str):
    """Resolve the company (COMPC) and branch (BRNCH) a new setup item should
    belong to, from the admin's rights. Defaults to (1, 1) when unresolved so
    NOT NULL columns are always satisfied."""
    final_c, final_b = _resolve_filter_lists(admin_card_no, None, None)

    def _first_int(lst, default):
        for v in (lst or []):
            try:
                return int(float(str(v).strip()))
            except (ValueError, TypeError):
                continue
        return default

    return _first_int(final_c, 1), _first_int(final_b, 1)


class AddDeptRequest(BaseModel):
    dept_name: str

class AddGradeRequest(BaseModel):
    grade_cd: str
    descr: str

class AddDesignationRequest(BaseModel):
    grade_cd: str
    desg_desc: str

class AddShiftRequest(BaseModel):
    shift: str
    shift_desc: str
    time_from: Optional[str] = None
    time_to: Optional[str] = None

class AddBloodGroupRequest(BaseModel):
    blood_group: str

class AddCadreRequest(BaseModel):
    cadre: str


@router.post("/departments")
def create_department(req: AddDeptRequest, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    if not req.dept_name.strip():
        raise HTTPException(status_code=400, detail="Department name is required")
    compc, brnch = _admin_compc_brnch(admin_card_no)
    result = add_department(req.dept_name, compc=compc, brnch=brnch)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.post("/grades")
def create_grade(req: AddGradeRequest, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    if not req.grade_cd.strip() or not req.descr.strip():
        raise HTTPException(status_code=400, detail="Grade code and description are required")
    compc, brnch = _admin_compc_brnch(admin_card_no)
    result = add_grade(req.grade_cd, req.descr, compc=compc, brnch=brnch)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.post("/designations")
def create_designation(req: AddDesignationRequest, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    if not req.grade_cd.strip() or not req.desg_desc.strip():
        raise HTTPException(status_code=400, detail="Grade code and designation name are required")
    compc, brnch = _admin_compc_brnch(admin_card_no)
    result = add_designation(req.grade_cd, req.desg_desc, compc=compc, brnch=brnch)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.post("/shifts")
def create_shift(req: AddShiftRequest, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    if not req.shift.strip() or not req.shift_desc.strip():
        raise HTTPException(status_code=400, detail="Shift code and description are required")
    compc, brnch = _admin_compc_brnch(admin_card_no)
    result = add_shift(req.shift, req.shift_desc, req.time_from, req.time_to, compc=compc, brnch=brnch)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.post("/blood-groups")
def create_blood_group(req: AddBloodGroupRequest, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    if not req.blood_group.strip():
        raise HTTPException(status_code=400, detail="Blood group is required")
    compc, brnch = _admin_compc_brnch(admin_card_no)
    result = add_blood_group(req.blood_group, compc=compc, brnch=brnch)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.post("/cadre")
def create_cadre(req: AddCadreRequest, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    if not req.cadre.strip():
        raise HTTPException(status_code=400, detail="Cadre name is required")
    compc, brnch = _admin_compc_brnch(admin_card_no)
    result = add_cadre(req.cadre, compc=compc, brnch=brnch)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


class AddUnitRequest(BaseModel):
    unit_name: str


@router.post("/units")
def create_unit(req: AddUnitRequest, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    if not req.unit_name.strip():
        raise HTTPException(status_code=400, detail="Unit name is required")
    result = add_unit(req.unit_name)
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


class LocationRequest(BaseModel):
    lcode: str
    descr: str
    sname: Optional[str] = None
    regioncode: Optional[str] = ""
    city: Optional[str] = ""


@router.post("/locations")
def create_location(req: LocationRequest, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    if not req.lcode.strip() or not req.descr.strip():
        raise HTTPException(status_code=400, detail="Location code and description are required")
    result = add_location(req.lcode, req.descr, req.sname or req.descr, req.regioncode or "", req.city or "")
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result


@router.put("/locations/{lcode}")
def edit_location(lcode: str, req: LocationRequest, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    if not req.descr.strip():
        raise HTTPException(status_code=400, detail="Description is required")
    result = update_location(lcode, req.descr, req.sname or req.descr, req.regioncode or "", req.city or "")
    if result["status"] == "error":
        raise HTTPException(status_code=400, detail=result["message"])
    return result
