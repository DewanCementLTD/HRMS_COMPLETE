from pydantic import BaseModel
from typing import List, Optional


class HRFaceEnrollRequest(BaseModel):
    card_no: str
    frames: List[str]           # base64-encoded JPEG images
    created_at: Optional[str] = None


class EmployeeSearchItem(BaseModel):
    card_no: str
    emp_name: str
    department: Optional[str] = None
    designation: Optional[str] = None
    face_registered: bool = False
