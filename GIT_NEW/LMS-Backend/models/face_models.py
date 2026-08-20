from pydantic import BaseModel
from typing import List, Optional


class FaceRegisterRequest(BaseModel):
    card_no: str
    frames: List[str]           # base64-encoded JPEG images
    created_at: Optional[str] = None


class FaceVerifyRequest(BaseModel):
    card_no: str
    frames: List[str]           # base64-encoded JPEG images


class FaceRegisterResponse(BaseModel):
    status: str                 # "SUCCESS" | "ERROR"
    card_no: str
    already_registered: bool = False
    msg: str = ""


class FaceVerifyResponse(BaseModel):
    is_match: bool
    confidence: float
    message: str = ""


class FaceIdentifyRequest(BaseModel):
    frames: List[str]           # base64-encoded JPEG images (no card_no needed)


class FaceStatusResponse(BaseModel):
    is_registered: bool
    card_no: str
    registered_at: Optional[str] = None
