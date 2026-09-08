from enum import Enum
from typing import List, Optional, Tuple
from pydantic import BaseModel, Field


class DisclosureLevel(str, Enum):
    L0 = "L0"  # Local only
    L1 = "L1"  # Structured semantic context
    L2 = "L2"  # Sanitized visual crop
    L3 = "L3"  # Sanitized full screen


class DisclosedElement(BaseModel):
    target_id: str
    role: str
    label: str = Field(..., description="Sanitized text with PII tokens ([PERSON_1], etc.)")
    bbox: Optional[Tuple[float, float, float, float]] = None


class Disclosure(BaseModel):
    level: DisclosureLevel
    reason: str = Field(..., description="Justification for escalation level")
    task: Optional[str] = None
    elements: List[DisclosedElement] = Field(default_factory=list)
    crop_box: Optional[Tuple[float, float, float, float]] = Field(default=None, description="[x,y,w,h]")
    screenshot_data: Optional[str] = Field(default=None, description="Base64 encoded sanitized image")
    redacted_token_count: int = Field(default=0, ge=0)
