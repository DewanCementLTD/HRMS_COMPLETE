from pydantic import BaseModel
from typing import Optional


class AttendanceRequest(BaseModel):
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class AttendanceResponse(BaseModel):
    status: str
    message: str


class FaceAttendanceRequest(BaseModel):
    card_no: str
    attendance_type: str                  # "check_in" | "check_out"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    accuracy: Optional[float] = None
    address: Optional[str] = None
    formatted_address: Optional[str] = None
    timestamp: Optional[str] = None
    device_id: Optional[str] = None
    device_model: Optional[str] = None
    app_version: Optional[str] = None
