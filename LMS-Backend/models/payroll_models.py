from pydantic import BaseModel
from typing import Optional


# ── Period Opening ──
class FinancialYearRequest(BaseModel):
    from_date: str
    to_date: str
    scode: Optional[str] = None
    descr: Optional[str] = None
    rate: Optional[float] = None
    intrst: Optional[float] = None
    filer: Optional[float] = None
    nonfiler: Optional[float] = None
    auto_periods: bool = True


class PeriodRequest(BaseModel):
    rule_id: Optional[int] = None
    period_frm: str
    period_to: str
    scode: Optional[str] = None


class StatusRequest(BaseModel):
    status: Optional[str] = None      # "O" | "C"
    block: Optional[str] = None       # "Y" | "N" (periods only)


# ── Tax Slabs ──
class TaxMasterRequest(BaseModel):
    tax_desc: str
    fyear: Optional[str] = None


class TaxDetailRequest(BaseModel):
    slab_from: Optional[float] = None
    slab_to: Optional[float] = None
    slab_rate: Optional[float] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None
    slab_ded: Optional[float] = None
    fixed_tax: Optional[float] = None


# ── Loans ──
class LoanTypeRequest(BaseModel):
    loan_desc: str


class LoanRequest(BaseModel):
    empcode: Optional[str] = None
    loan_cd: Optional[str] = None
    loan_date: Optional[str] = None
    loan_amt: Optional[float] = None
    instalment_amt: Optional[float] = None
    nof_instalment: Optional[int] = None
    start_dt: Optional[str] = None
    charge_int: Optional[str] = None
    int_rate: Optional[float] = None
    chq_no: Optional[str] = None
    chq_dt: Optional[str] = None
    remarks: Optional[str] = None
