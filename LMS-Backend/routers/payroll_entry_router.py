"""Payroll entry router — /payroll-entry/* (HR admin only).

Period-based payroll inputs scoped to the admin's selected company & branch:
loan recovery, monthly allowances, monthly deductions and absent days. All
period-keyed actions use the company's currently *open* period.
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from core.dependencies import require_hr_admin
from routers.payroll_router import _company, _branch, _checked, USR
from models.payroll_entry_models import (
    LoanRecoveryRequest, MonthlyAllowanceRequest, MonthlyDeductionRequest, AbsentDaysRequest,
)
from repositories.payroll_entry_repository import (
    list_open_periods, recovery_types,
    list_recoverable_loans, list_loan_recoveries, create_loan_recovery, delete_loan_recovery,
    list_allowance_types, list_monthly_allowances, upsert_monthly_allowance, delete_monthly_allowance,
    list_deduction_types, list_monthly_deductions, upsert_monthly_deduction, delete_monthly_deduction,
    list_absent_days, get_employee_absent, set_absent_days, delete_absent_days,
)

router = APIRouter(prefix="/payroll-entry", tags=["Payroll Entry"])


# ─────────────────────────── Open periods / LOVs ───────────────────────────

@router.get("/open-periods")
def get_open_periods(admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return {"items": list_open_periods(_company(admin_card_no, compc))}


@router.get("/recovery-types")
def get_recovery_types(admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    return {"items": recovery_types()}


@router.get("/allowance-types")
def get_allowance_types(admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    return {"items": list_allowance_types()}


@router.get("/deduction-types")
def get_deduction_types(admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return {"items": list_deduction_types(_company(admin_card_no, compc))}


# ─────────────────────────── Loan recovery ───────────────────────────

@router.get("/loans")
def get_recoverable_loans(admin_card_no: str = Query(...), compc: Optional[str] = Query(None),
                          brnch: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return {"items": list_recoverable_loans(_company(admin_card_no, compc),
                                            _branch(admin_card_no, compc, brnch))}


@router.get("/loan-recoveries")
def get_loan_recoveries(admin_card_no: str = Query(...), compc: Optional[str] = Query(None),
                        brnch: Optional[str] = Query(None), doc: Optional[int] = Query(None)):
    require_hr_admin(admin_card_no)
    return {"items": list_loan_recoveries(_company(admin_card_no, compc), doc,
                                          _branch(admin_card_no, compc, brnch))}


@router.post("/loan-recoveries")
def post_loan_recovery(req: LoanRecoveryRequest, admin_card_no: str = Query(...),
                       compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return _checked(create_loan_recovery(
        _company(admin_card_no, compc), req.doc, req.recovery_type, req.recovered_amt,
        req.remarks, req.int_rate_rec, usr=USR,
    ))


@router.delete("/loan-recoveries")
def del_loan_recovery(admin_card_no: str = Query(...), rowid: str = Query(...),
                      compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return _checked(delete_loan_recovery(_company(admin_card_no, compc), rowid))


# ─────────────────────────── Monthly allowances ───────────────────────────

@router.get("/allowances")
def get_monthly_allowances(admin_card_no: str = Query(...), compc: Optional[str] = Query(None),
                           brnch: Optional[str] = Query(None), empcode: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return {"items": list_monthly_allowances(_company(admin_card_no, compc), None, empcode,
                                             _branch(admin_card_no, compc, brnch))}


@router.post("/allowances")
def post_monthly_allowance(req: MonthlyAllowanceRequest, admin_card_no: str = Query(...),
                           compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return _checked(upsert_monthly_allowance(
        _company(admin_card_no, compc), req.empcode, req.allowance_id, req.amount,
        req.ot_hour, req.remarks, usr=USR,
    ))


@router.delete("/allowances")
def del_monthly_allowance(admin_card_no: str = Query(...), empcode: str = Query(...),
                          allowance_id: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return _checked(delete_monthly_allowance(_company(admin_card_no, compc), empcode, allowance_id))


# ─────────────────────────── Monthly deductions ───────────────────────────

@router.get("/deductions")
def get_monthly_deductions(admin_card_no: str = Query(...), compc: Optional[str] = Query(None),
                           brnch: Optional[str] = Query(None), empcode: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return {"items": list_monthly_deductions(_company(admin_card_no, compc), None, empcode,
                                             _branch(admin_card_no, compc, brnch))}


@router.post("/deductions")
def post_monthly_deduction(req: MonthlyDeductionRequest, admin_card_no: str = Query(...),
                           compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return _checked(upsert_monthly_deduction(
        _company(admin_card_no, compc), req.empcode, req.deduction_id, req.amount, req.remarks, usr=USR,
    ))


@router.delete("/deductions")
def del_monthly_deduction(admin_card_no: str = Query(...), empcode: str = Query(...),
                          deduction_id: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return _checked(delete_monthly_deduction(_company(admin_card_no, compc), empcode, deduction_id))


# ─────────────────────────── Absent days ───────────────────────────

@router.get("/absent-days")
def get_absent_days(admin_card_no: str = Query(...), compc: Optional[str] = Query(None),
                    brnch: Optional[str] = Query(None), empcode: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return {"items": list_absent_days(_company(admin_card_no, compc), None, empcode,
                                      _branch(admin_card_no, compc, brnch))}


@router.get("/absent-days/employee")
def get_employee_absent_days(admin_card_no: str = Query(...), empcode: str = Query(...),
                             compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return get_employee_absent(_company(admin_card_no, compc), empcode)


@router.post("/absent-days")
def post_absent_days(req: AbsentDaysRequest, admin_card_no: str = Query(...),
                     compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return _checked(set_absent_days(_company(admin_card_no, compc), req.empcode, req.absent_days, usr=USR))


@router.delete("/absent-days")
def del_absent_days(admin_card_no: str = Query(...), empcode: str = Query(...),
                    compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return _checked(delete_absent_days(_company(admin_card_no, compc), empcode))
