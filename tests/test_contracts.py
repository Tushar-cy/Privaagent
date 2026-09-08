import json
import os
import sys
from pathlib import Path

# Add server to path
SERVER_PATH = Path(__file__).parent.parent / "server"
sys.path.insert(0, str(SERVER_PATH))

from app.schemas.page_state import PageState, PageElement, PerceptionSource
from app.schemas.action import Action, ActionType
from app.schemas.disclosure import Disclosure, DisclosureLevel, DisclosedElement


def test_page_state_validation():
    data = {
        "url": "http://localhost:8000/benchmark/test-page-1.html",
        "title": "Benchmark Fixture",
        "timestamp": 1725800000000.0,
        "elements": [
            {
                "target_id": "elem_1",
                "role": "button",
                "text": "Open Rahul's invoice",
                "bbox": [100.0, 200.0, 150.0, 40.0],
                "confidence": 1.0,
                "sensitive": False,
                "task_relevance": 0.9,
                "sources": ["dom", "a11y"],
                "interactable": True,
            }
        ],
    }
    state = PageState(**data)
    assert state.url == "http://localhost:8000/benchmark/test-page-1.html"
    assert len(state.elements) == 1
    assert state.elements[0].sources == [PerceptionSource.DOM, PerceptionSource.A11Y]


def test_action_validation():
    action_data = {
        "action": "click",
        "target_id": "elem_1",
        "reason": "Open invoice button clicked",
        "confidence": 1.0,
    }
    action = Action(**action_data)
    assert action.action == ActionType.CLICK
    assert action.target_id == "elem_1"


def test_disclosure_validation():
    disc_data = {
        "level": "L1",
        "reason": "Needs higher-level semantic reasoning",
        "task": "Open invoice",
        "elements": [
            {
                "target_id": "elem_1",
                "role": "button",
                "label": "Open [PERSON_1]'s invoice",
            }
        ],
        "redacted_token_count": 1,
    }
    disc = Disclosure(**disc_data)
    assert disc.level == DisclosureLevel.L1
    assert disc.redacted_token_count == 1
    assert disc.elements[0].label == "Open [PERSON_1]'s invoice"


if __name__ == "__main__":
    test_page_state_validation()
    test_action_validation()
    test_disclosure_validation()
    print("[SUCCESS] All contract tests passed successfully!")
