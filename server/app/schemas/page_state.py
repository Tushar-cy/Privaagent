from enum import Enum
from typing import List, Optional, Tuple, Dict, Any
from pydantic import BaseModel, Field, HttpUrl


class PerceptionSource(str, Enum):
    DOM = "dom"
    A11Y = "a11y"
    OCR = "ocr"
    VISION = "vision"
    CV = "cv"


class Viewport(BaseModel):
    width: float
    height: float
    scrollX: float = 0.0
    scrollY: float = 0.0


class PageElement(BaseModel):
    target_id: str = Field(..., description="Unique, stable identifier within current page snapshot")
    role: str = Field(..., description="Semantic or visual role")
    text: str = Field(..., description="Visible text or label")
    bbox: Tuple[float, float, float, float] = Field(..., description="[x, y, w, h]")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    sensitive: bool = Field(default=False, description="Flagged true if element contains PII/secrets")
    task_relevance: float = Field(default=0.0, ge=0.0, le=1.0)
    sources: List[PerceptionSource] = Field(..., min_length=1)
    interactable: bool = Field(default=True)
    metadata: Optional[Dict[str, Any]] = None


class PageState(BaseModel):
    url: str
    title: str = ""
    timestamp: float
    viewport: Optional[Viewport] = None
    elements: List[PageElement]
