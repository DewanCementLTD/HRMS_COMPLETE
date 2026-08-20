from pydantic import BaseModel
from typing import Optional


# ── Loan recovery / adjustment ──
class LoanRecoveryRequest(BaseModel):
    doc: int
    recovery_type: Optional[str] = "C"
    recovered_amt: float
    remarks: Optional[str] = None
    int_rate_rec: Optional[float] = None


# ── Monthly allowance ──
class MonthlyAllowanceRequest(BaseModel):
    empcode: str
    allowance_id: str
    amount: float
    ot_hour: Optional[float] = None
    remarks: Optional[str] = None


# ── Monthly deduction ──
class MonthlyDeductionRequest(BaseModel):
    empcode: str
    deduction_id: str
    amount: float
    remarks: Optional[str] = None


# ── Absent days ──
class AbsentDaysRequest(BaseModel):
    empcode: str
    absent_days: float
