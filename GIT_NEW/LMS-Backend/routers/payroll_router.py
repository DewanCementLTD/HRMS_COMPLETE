"""Payroll router — /payroll/* (HR admin only).

Period Opening (financial years + monthly periods) and loans are scoped to the
admin's selected company; tax slabs and loan types are global.
"""

from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from core.dependencies import require_hr_admin
from routers.hrms_router import _resolve_filter_lists
from models.payroll_models import (
    FinancialYearRequest, PeriodRequest, StatusRequest,
    TaxMasterRequest, TaxDetailRequest, LoanTypeRequest, LoanRequest,
)
from repositories.payroll_repository import (
    list_financial_years, create_financial_year, update_financial_year, set_financial_year_status,
    list_periods, create_period, set_period_status,
    list_tax_masters, create_tax_master, set_tax_master_status, delete_tax_master,
    list_tax_details, add_tax_detail, delete_tax_detail,
    list_loan_types, add_loan_type, delete_loan_type,
    list_loans, create_loan, update_loan, delete_loan,
)
from repositories.salary_repository import (
    list_salary_periods, list_processed_salaries, get_payslip,
    get_open_period, run_salary_process,
)
from repositories.payroll_register_repository import (
    get_pay_register, get_pay_register_periods,
)

router = APIRouter(prefix="/payroll", tags=["Payroll"])
USR = "HR"


def _company(admin_card_no: str, compc: Optional[str]) -> int:
    """Resolve the company a per-company payroll record belongs to: the selected
    company when within the admin's rights, else the admin's first company."""
    final_c, _ = _resolve_filter_lists(admin_card_no, compc, None)

    def _to_int(v):
        try:
            return int(float(str(v).strip()))
        except (ValueError, TypeError):
            return None

    if compc:
        ci = _to_int(compc)
        allowed = {_to_int(c) for c in (final_c or [])}
        if ci is not None and (not allowed or ci in allowed):
            return ci
    for v in (final_c or []):
        iv = _to_int(v)
        if iv is not None:
            return iv
    return 1


# ── Pay Register report (read-only, from HR_PAY_REG_V) ──────────────
@router.get("/pay-register/periods")
def pay_register_periods(admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return {"items": get_pay_register_periods(_company(admin_card_no, compc))}


@router.get("/pay-register")
def pay_register(
    admin_card_no: str = Query(...),
    period: int = Query(...),
    compc: Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    dept_no: Optional[str] = Query(None),
    desg_cd: Optional[str] = Query(None),
    empcode: Optional[str] = Query(None),
):
    require_hr_admin(admin_card_no)
    unit_id = _company(admin_card_no, compc)
    return get_pay_register(unit_id, period, location, dept_no, desg_cd, empcode)


def _checked(result: dict):
    if isinstance(result, dict) and result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("message"))
    return result


# ─────────────────────────── Period Opening ───────────────────────────

@router.get("/financial-years")
def get_financial_years(admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return {"items": list_financial_years(_company(admin_card_no, compc))}


@router.post("/financial-years")
def post_financial_year(req: FinancialYearRequest, admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return _checked(create_financial_year(
        req.from_date, req.to_date, req.scode, req.descr, _company(admin_card_no, compc),
        usr=USR, rate=req.rate, intrst=req.intrst, filer=req.filer, nonfiler=req.nonfiler,
        auto_periods=req.auto_periods,
    ))


@router.put("/financial-years/{rule_id}")
def put_financial_year(rule_id: int, req: FinancialYearRequest, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    return _checked(update_financial_year(
        rule_id, from_date=req.from_date, to_date=req.to_date, scode=req.scode, descr=req.descr,
        rate=req.rate, intrst=req.intrst, filer=req.filer, nonfiler=req.nonfiler,
    ))


@router.patch("/financial-years/{rule_id}/status")
def patch_financial_year_status(rule_id: int, req: StatusRequest, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    return _checked(set_financial_year_status(rule_id, req.status))


@router.get("/periods")
def get_periods(admin_card_no: str = Query(...), compc: Optional[str] = Query(None), rule_id: Optional[int] = Query(None)):
    require_hr_admin(admin_card_no)
    return {"items": list_periods(_company(admin_card_no, compc), rule_id)}


@router.post("/periods")
def post_period(req: PeriodRequest, admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return _checked(create_period(req.rule_id, req.period_frm, req.period_to, req.scode,
                                  _company(admin_card_no, compc), usr=USR))


@router.patch("/periods/{period}/status")
def patch_period_status(period: int, req: StatusRequest, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    return _checked(set_period_status(period, req.status, req.block))


# ─────────────────────────── Tax Slabs (global) ───────────────────────────

@router.get("/tax-masters")
def get_tax_masters(admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    return {"items": list_tax_masters()}


@router.post("/tax-masters")
def post_tax_master(req: TaxMasterRequest, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    if not req.tax_desc.strip():
        raise HTTPException(status_code=400, detail="Description is required")
    return _checked(create_tax_master(req.tax_desc, req.fyear, usr=USR))


@router.patch("/tax-masters/{tax_id}/status")
def patch_tax_master_status(tax_id: int, req: StatusRequest, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    return _checked(set_tax_master_status(tax_id, req.status))


@router.delete("/tax-masters/{tax_id}")
def del_tax_master(tax_id: int, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    return _checked(delete_tax_master(tax_id))


@router.get("/tax-masters/{tax_id}/details")
def get_tax_details(tax_id: int, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    return {"items": list_tax_details(tax_id)}


@router.post("/tax-masters/{tax_id}/details")
def post_tax_detail(tax_id: int, req: TaxDetailRequest, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    return _checked(add_tax_detail(
        tax_id, req.slab_from, req.slab_to, req.slab_rate, req.date_from, req.date_to,
        req.slab_ded, req.fixed_tax, usr=USR,
    ))


@router.delete("/tax-masters/{tax_id}/details/{srno}")
def del_tax_detail(tax_id: int, srno: int, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    return _checked(delete_tax_detail(tax_id, srno))


# ─────────────────────────── Loans ───────────────────────────

@router.get("/loan-types")
def get_loan_types(admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    return {"items": list_loan_types()}


@router.post("/loan-types")
def post_loan_type(req: LoanTypeRequest, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    if not req.loan_desc.strip():
        raise HTTPException(status_code=400, detail="Description is required")
    return _checked(add_loan_type(req.loan_desc, usr=USR))


@router.delete("/loan-types/{loan_cd}")
def del_loan_type(loan_cd: str, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    return _checked(delete_loan_type(loan_cd))


@router.get("/loans")
def get_loans(admin_card_no: str = Query(...), compc: Optional[str] = Query(None), empcode: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return {"items": list_loans(_company(admin_card_no, compc), empcode)}


@router.post("/loans")
def post_loan(req: LoanRequest, admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    if not req.empcode:
        raise HTTPException(status_code=400, detail="Employee is required")
    return _checked(create_loan(
        req.empcode, req.loan_cd, req.loan_date, req.loan_amt, req.instalment_amt,
        req.nof_instalment, req.start_dt, req.charge_int, req.int_rate, req.chq_no,
        req.chq_dt, req.remarks, _company(admin_card_no, compc), usr=USR,
    ))


@router.put("/loans/{doc}")
def put_loan(doc: int, req: LoanRequest, admin_card_no: str = Query(...)):
    require_hr_admin(admin_card_no)
    return _checked(update_loan(
        doc, loan_cd=req.loan_cd, loan_date=req.loan_date, loan_amt=req.loan_amt,
        instalment_amt=req.instalment_amt, nof_instalment=req.nof_instalment,
        start_dt=req.start_dt, charge_int=req.charge_int, int_rate=req.int_rate,
        chq_no=req.chq_no, chq_dt=req.chq_dt, remarks=req.remarks,
    ))


@router.delete("/loans/{doc}")
def del_loan(doc: int, admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return _checked(delete_loan(doc, _company(admin_card_no, compc)))


# ─────────────────────────── Salary / Payslips (read-only) ───────────────────────────

def _branch(admin_card_no: str, compc: Optional[str], brnch: Optional[str]) -> Optional[str]:
    """The branch (LOCATION) to filter by: the selected branch when within the
    admin's rights, else None (all branches of the company)."""
    if not brnch:
        return None
    _, final_b = _resolve_filter_lists(admin_card_no, compc, brnch)
    allowed = {str(b).strip() for b in (final_b or [])}
    return str(brnch).strip() if (not allowed or str(brnch).strip() in allowed) else None


@router.get("/salary/periods")
def get_salary_periods(admin_card_no: str = Query(...), compc: Optional[str] = Query(None),
                       brnch: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return {"items": list_salary_periods(_company(admin_card_no, compc), _branch(admin_card_no, compc, brnch))}


@router.get("/salary/sheet")
def get_salary_sheet(admin_card_no: str = Query(...), period: int = Query(...),
                     compc: Optional[str] = Query(None), brnch: Optional[str] = Query(None),
                     q: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    return {"items": list_processed_salaries(_company(admin_card_no, compc), period, q,
                                             _branch(admin_card_no, compc, brnch))}


@router.get("/salary/payslip")
def get_salary_payslip(admin_card_no: str = Query(...), empcode: str = Query(...),
                       period: int = Query(...), compc: Optional[str] = Query(None)):
    require_hr_admin(admin_card_no)
    ps = get_payslip(_company(admin_card_no, compc), empcode, period)
    if not ps:
        raise HTTPException(status_code=404, detail="No processed salary for this employee/period")
    return ps


@router.get("/salary/open-period")
def get_salary_open_period(admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    """The company's open period — what the 'Run Salary Process' button will act on."""
    require_hr_admin(admin_card_no)
    return {"open_period": get_open_period(_company(admin_card_no, compc))}


@router.post("/salary/process")
def post_salary_process(admin_card_no: str = Query(...), compc: Optional[str] = Query(None)):
    """Run the ERP salary-process procedure for the company's open period."""
    require_hr_admin(admin_card_no)
    return _checked(run_salary_process(_company(admin_card_no, compc)))
