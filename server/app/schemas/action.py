from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


class ActionType(str, Enum):
    CLICK = "click"
    TYPE = "type"
    SCROLL = "scroll"
    SELECT = "select"
    NAVIGATE = "navigate"


class ScrollDelta(BaseModel):
    x: float = 0.0
    y: float = 0.0


class Action(BaseModel):
    action: ActionType
    target_id: str = Field(..., description="Target element ID")
    reason: str = Field(..., description="Reasoning for this action")
    value: Optional[str] = Field(default=None, description="Input string for type/select")
    delta: Optional[ScrollDelta] = Field(default=None, description="Pixel delta for scroll")
    url: Optional[str] = Field(default=None, description="Destination URL for navigate")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)
    model_used: Optional[str] = Field(default=None, description="Actual model identifier used for inference")
    execution_backend: Optional[str] = Field(default=None, description="Actual execution engine or provider")
