from pydantic import BaseModel
from typing import List, Optional


# =========================
# AUTH
# =========================

class LoginRequest(BaseModel):
    username: str
    password: str


class CompanyItem(BaseModel):
    code: str
    name: str


class BranchItem(BaseModel):
    code: str
    name: str


class LoginResponse(BaseModel):
    status: str
    card_no: str
    emp_name: str = ""
    face_registered: bool = False
    hr_admin: bool = False
    has_self_service: bool = True
    has_employee_features: bool = True  # True if user is in HR_EMP_MASTER (can access employee modules)
    allowed_companies: List[str] = []
    allowed_branches: List[str] = []
    company_list: List[CompanyItem] = []
    branch_list: List[BranchItem] = []


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class MessageResponse(BaseModel):
    status: str
    message: str


# =========================
# DASHBOARD
# =========================

class DashboardResponse(BaseModel):
    emp_pk: Optional[float] = None
    card_no: str
    emp_no: Optional[str] = None
    emp_name: str
    date_of_join: Optional[str] = None
    nic_no: Optional[str] = None
    designation: Optional[str] = None
    department: Optional[str] = None
    compcnm: Optional[str] = None
    compc: Optional[float] = None
    branch: Optional[float] = None
    brnchnm: Optional[str] = None
    hod: Optional[float] = None
    hod_nm: Optional[str] = None
    balance: Optional[float] = None


# =========================
# LEAVE
# =========================

class LeaveBalanceResponse(BaseModel):
    leave_type: str
    leave_desc: Optional[str]
    balance: float


class LeaveApplyRequest(BaseModel):
    # Flutter sends: type (leave code), from_date, to_date, reason, half_day
    # card_no comes from the URL path parameter
    type: Optional[str] = None          # Flutter field name
    leave_type_id: Optional[int] = None  # numeric FK (if known)
    from_date: str
    to_date: str
    reason: str
    half_day: Optional[bool] = False
    compc: int = 0
    brnch: int = 0
    emp_name: str = ''


class LeaveStatusResponse(BaseModel):
    leave_type: str
    from_date: str
    to_date: str
    status: str


# =========================
# PROFILE
# =========================

class ProfileResponse(BaseModel):
    emp_name: str
    department: Optional[str]
    designation: Optional[str]
    email_address: Optional[str]
    mobile_no: Optional[str]
    date_of_birth: Optional[str]
    date_of_join: Optional[str]
    father_name: Optional[str]
    nic_no: Optional[str]


# Attendance models moved to models/attendance_models.py