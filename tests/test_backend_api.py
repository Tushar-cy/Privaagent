import os
import sys
from pathlib import Path
import pytest

SERVER_PATH = Path(__file__).parent.parent / "server"
sys.path.insert(0, str(SERVER_PATH))

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"

    api_resp = client.get("/api/health")
    assert api_resp.status_code == 200
    api_data = api_resp.json()
    assert api_data["status"] == "ok"
    assert "Privaagent" in api_data["service"]


def test_resolve_action_valid_disclosure(monkeypatch):
    from app.api import routes
    monkeypatch.setattr(routes.vlm_client, "provider", "mock")
    valid_payload = {
        "level": "L1",
        "reason": "Escalation to L1 due to complex visual reasoning required",
        "task": "Click on Q4 revenue bar",
        "elements": [
            {
                "target_id": "revenue-chart_bar_1",
                "role": "chart_bar",
                "label": "Q1 Revenue [REDACTED_CONFIDENTIAL]",
                "bounds": [490.0, 185.0, 48.0, 75.0],
            },
            {
                "target_id": "revenue-chart_bar_4",
                "role": "chart_bar",
                "label": "Q4 Revenue [REDACTED_CONFIDENTIAL]",
                "bounds": [739.0, 115.0, 48.0, 145.0],
            }
        ],
        "redacted_token_count": 2,
    }

    response = client.post("/api/resolve-action", json=valid_payload)
    assert response.status_code == 200
    data = response.json()
    assert data["action"] in ["click", "type", "scroll", "navigate", "wait", "finish"]
    assert data["target_id"] == "revenue-chart_bar_4"
    assert data["confidence"] > 0.5


def test_defense_in_depth_rejects_pan_leak():
    leaked_payload = {
        "level": "L1",
        "reason": "Test leak",
        "task": "Open customer profile",
        "elements": [
            {
                "target_id": "cust-info",
                "role": "text",
                "label": "Customer PAN is ABCDE1234F",  # Raw PAN leak!
                "bounds": [10.0, 10.0, 100.0, 30.0],
            }
        ],
        "redacted_token_count": 0,
    }

    response = client.post("/api/resolve-action", json=leaked_payload)
    assert response.status_code == 422
    assert "Defense-in-depth violation" in response.json()["detail"]
    assert "PAN" in response.json()["detail"]


def test_defense_in_depth_rejects_email_leak():
    leaked_payload = {
        "level": "L1",
        "reason": "Test leak",
        "task": "Send invoice to user@example.com",  # Raw Email leak!
        "elements": [
            {
                "target_id": "submit-btn",
                "role": "button",
                "label": "Send",
                "bounds": [10.0, 10.0, 50.0, 20.0],
            }
        ],
        "redacted_token_count": 0,
    }

    response = client.post("/api/resolve-action", json=leaked_payload)
    assert response.status_code == 422
    assert "Defense-in-depth violation" in response.json()["detail"]
    assert "EMAIL" in response.json()["detail"]


def test_defense_in_depth_rejects_secret_leak():
    leaked_payload = {
        "level": "L1",
        "reason": "sk-1234567890abcdef1234567890",  # Raw API key leak!
        "task": "Click submit",
        "elements": [
            {
                "target_id": "submit-btn",
                "role": "button",
                "label": "Submit",
                "bounds": [10.0, 10.0, 50.0, 20.0],
            }
        ],
        "redacted_token_count": 0,
    }

    response = client.post("/api/resolve-action", json=leaked_payload)
    assert response.status_code == 422
    assert "Defense-in-depth violation" in response.json()["detail"]
    assert "SECRET_KEY" in response.json()["detail"]
