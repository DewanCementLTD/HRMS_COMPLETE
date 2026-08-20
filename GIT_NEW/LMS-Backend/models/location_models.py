from pydantic import BaseModel
from typing import List


class LocationPoint(BaseModel):
    latitude: float
    longitude: float
    accuracy: float = 0.0
    recorded_at: str  # ISO 8601 e.g. "2024-04-18T14:30:00.000000"


class LocationBatchRequest(BaseModel):
    card_no: str
    locations: List[LocationPoint]
