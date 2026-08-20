from pydantic import BaseModel
from typing import List, Optional


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
    app_build: Optional[int] = None       # monotonic build number (for version checks)
    # Base64 JPEG frames of the face being marked (same frames the app captures for
    # /face/identify). When present, the server re-verifies them against card_no via
    # the 8002 face service before marking, so a wrong card can never be marked for
    # someone else's face. Optional for backward compatibility with older app builds.
    frames: Optional[List[str]] = None
