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
    add_emp_status, delete_emp_status, add_bank, delete_bank,
    add_bank_branch, delete_bank_branch, add_qualification, delete_qualification,
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
def list_emp_statuses(compc: Optional[str] = Query(None)):
    return {"items": get_emp_statuses(compc)}


@router.get("/banks")
def list_banks(compc: Optional[str] = Query(None)):
    return {"items": get_banks(compc)}


@router.get("/bank-branches")
def list_bank_branches(bnkcode: Optional[str] = Query(None)):
    return {"items": get_bank_branches(bnkcode)}


@router.get("/qualifications")
def list_qualifications(compc: Optional[str] = Query(None)):
    return {"items": get_qualifications(compc)}


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


def _setup_company(admin_card_no: str, compc: Optional[str]) -> int:
    """Resolve which company a Setup add/remove targets: the selected company
    (compc) when it's within the admin's rights, else the admin's first company."""
    final_c, _ = _resolve_filter_lists(admin_card_no, compc, None)

    def _to_int(v, default):
        try:
            return int(float(str(v).strip()))
        except (ValueError, TypeError):
            return default

    if compc:
        ci = _to_int(compc, None)
        allowed = {_to_int(c, None) for c in (final_c or [])}
        if ci is not None and (not allowed or ci in allowed):
            return ci
    for v in (final_c or []):
        iv = _to_int(v, None)
        if iv is not None:
            return iv
    return 1


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


# ─────────────────────────────────────────────────────────────────
# Per-company lookup management (Setup): employee status, bank,
# bank branch, qualification — add/remove scoped to the selected company.
# ─────────────────────────────────────────────────────────────────

class AddEmpStatusRequest(BaseModel):
    descr: str

class AddBankRequest(BaseModel):
    bnkname: str

class AddBankBranchRequest(BaseModel):
    bnkcode: str
    brnname: str

class AddQualificationRequest(BaseModel):
    descr: str


def _checked(result: dict):
    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return result


@router.post("/emp-statuses")
def create_emp_status(req: AddEmpStatusRequest, admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    if not req.descr.strip():
        raise HTTPException(status_code=400, detail="Description is required")
    return _checked(add_emp_status(req.descr, compc=_setup_company(admin_card_no, compc)))


@router.delete("/emp-statuses/{emp_status}")
def remove_emp_status(emp_status: str, admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return _checked(delete_emp_status(emp_status, compc=_setup_company(admin_card_no, compc)))


@router.post("/banks")
def create_bank(req: AddBankRequest, admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    if not req.bnkname.strip():
        raise HTTPException(status_code=400, detail="Bank name is required")
    return _checked(add_bank(req.bnkname, compc=_setup_company(admin_card_no, compc)))


@router.delete("/banks/{bnkcode}")
def remove_bank(bnkcode: str, admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return _checked(delete_bank(bnkcode, compc=_setup_company(admin_card_no, compc)))


@router.post("/bank-branches")
def create_bank_branch(req: AddBankBranchRequest, admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    if not req.bnkcode.strip() or not req.brnname.strip():
        raise HTTPException(status_code=400, detail="Bank and branch name are required")
    return _checked(add_bank_branch(req.bnkcode, req.brnname, compc=_setup_company(admin_card_no, compc)))


@router.delete("/bank-branches/{bnkcode}/{brncode}")
def remove_bank_branch(bnkcode: str, brncode: str, admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return _checked(delete_bank_branch(bnkcode, brncode, compc=_setup_company(admin_card_no, compc)))


@router.post("/qualifications")
def create_qualification(req: AddQualificationRequest, admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    if not req.descr.strip():
        raise HTTPException(status_code=400, detail="Qualification is required")
    return _checked(add_qualification(req.descr, compc=_setup_company(admin_card_no, compc)))


@router.delete("/qualifications/{descr}")
def remove_qualification(descr: str, admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return _checked(delete_qualification(descr, compc=_setup_company(admin_card_no, compc)))
