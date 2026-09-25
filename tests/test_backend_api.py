import os
import sys
from pathlib import Path
import pytest

SERVER_PATH = Path(__file__).parent.parent / "server"
sys.path.insert(0, str(SERVER_PATH))

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

# The token we configured above — sent on all protected requests
AUTH_HEADERS = {"X-Privaagent-Session-Token": "ci-test-token-privaagent"}


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


def test_resolve_action_rejects_missing_auth():
    """P0: /api/resolve-action must return 401 when no session token is supplied."""
    payload = {
        "level": "L1",
        "reason": "No token test",
        "task": "Click submit",
        "elements": [
            {
                "target_id": "el_0001",
                "role": "button",
                "label": "Submit",
                "bounds": [10.0, 10.0, 50.0, 20.0],
            }
        ],
        "redacted_token_count": 0,
    }
    response = client.post("/api/resolve-action", json=payload)
    assert response.status_code == 401, (
        f"Expected 401 for missing auth, got {response.status_code}: {response.text}"
    )
    assert "Unauthorized" in response.json()["detail"]


def test_resolve_action_rejects_wrong_token():
    """P0: /api/resolve-action must return 401 when an incorrect session token is supplied."""
    payload = {
        "level": "L1",
        "reason": "Wrong token test",
        "task": "Click submit",
        "elements": [
            {
                "target_id": "el_0001",
                "role": "button",
                "label": "Submit",
                "bounds": [10.0, 10.0, 50.0, 20.0],
            }
        ],
        "redacted_token_count": 0,
    }
    response = client.post(
        "/api/resolve-action",
        json=payload,
        headers={"X-Privaagent-Session-Token": "totally-wrong-token"},
    )
    assert response.status_code == 401, (
        f"Expected 401 for wrong token, got {response.status_code}: {response.text}"
    )
    assert "Unauthorized" in response.json()["detail"]


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

    response = client.post("/api/resolve-action", json=valid_payload, headers=AUTH_HEADERS)
    assert response.status_code == 200
    data = response.json()
    assert data["action"] in ["click", "type", "scroll", "navigate", "wait", "finish"]
    assert data["target_id"] == "revenue-chart_bar_4"
    assert data["confidence"] > 0.5


def test_resolve_action_hides_internal_vlm_errors(monkeypatch):
    from app.api import routes

    async def fail_prediction(_disclosure):
        raise RuntimeError("private endpoint details must stay in server logs")

    monkeypatch.setattr(routes.vlm_client, "predict_action", fail_prediction)
    payload = {
        "level": "L1",
        "reason": "Test generic service error",
        "task": "Click submit",
        "elements": [{"target_id": "el_0001", "role": "button", "label": "Submit"}],
        "redacted_token_count": 0,
    }

    response = client.post("/api/resolve-action", json=payload, headers=AUTH_HEADERS)

    assert response.status_code == 500
    assert response.json()["detail"] == "VLM reasoning service unavailable."
    assert "private endpoint details" not in response.text


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

    response = client.post("/api/resolve-action", json=leaked_payload, headers=AUTH_HEADERS)
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

    response = client.post("/api/resolve-action", json=leaked_payload, headers=AUTH_HEADERS)
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

    response = client.post("/api/resolve-action", json=leaked_payload, headers=AUTH_HEADERS)
    assert response.status_code == 422
    assert "Defense-in-depth violation" in response.json()["detail"]
    assert "SECRET_KEY" in response.json()["detail"]


@pytest.mark.parametrize("secret", [
    "gho_0123456789abcdefghijklmnopqrstuv",
    "ghs_0123456789abcdefghijklmnopqrstuv",
    "ghr_0123456789abcdefghijklmnopqrstuv",
    "glpat-0123456789abcdefghijklmnopqrstuv",
    "xoxb-0123456789abcdefghijklmnopqrstuv",
    "xoxp-0123456789abcdefghijklmnopqrstuv",
    "xapp-0123456789abcdefghijklmnopqrstuv",
    "pk_0123456789abcdefghijklmnop",
    "rk_0123456789abcdefghijklmnop",
    "hf_0123456789abcdefghijklmnop",
    "sk-ant-api03-0123456789abcdefghijklmnop",
    "Authorization: Bearer 0123456789abcdefghijklmnop",
    "aB3cD4eF5gH6iJ7kL8mN9pQ0rS1tUv2",
])
def test_defense_in_depth_rejects_client_supported_secret_patterns(secret):
    payload = {
        "level": "L1",
        "reason": "Secret detector parity test",
        "task": f"Use credential {secret}",
        "elements": [{"target_id": "el_0001", "role": "button", "label": "Submit"}],
        "redacted_token_count": 0,
    }

    response = client.post("/api/resolve-action", json=payload, headers=AUTH_HEADERS)

    assert response.status_code == 422
    assert "SECRET_KEY" in response.json()["detail"]


def test_token_status_enforced():
    """Test that /api/token-status correctly reports 'enforced' mode."""
    response = client.get("/api/token-status")
    assert response.status_code == 200
    data = response.json()
    assert data["auth_mode"] == "enforced"
    assert data["paired"] is True


def test_demo_mode_allows_request(monkeypatch):
    """Test that when SESSION_TOKEN is the sentinel, requests without auth are allowed (demo mode)."""
    # Override settings.SESSION_TOKEN for this test
    from app.config import settings
    monkeypatch.setattr(settings, "SESSION_TOKEN", "change-this-for-local-evaluation")
    
    # Also mock VLM client so we get a real response, not just a 401/422
    from app.api import routes
    monkeypatch.setattr(routes.vlm_client, "provider", "mock")
    
    response = client.get("/api/token-status")
    assert response.status_code == 200
    assert response.json()["auth_mode"] == "demo"
    assert response.json()["paired"] is False

    valid_payload = {
        "level": "L1",
        "reason": "Demo mode test",
        "task": "Click submit",
        "elements": [
            {
                "target_id": "el_0001",
                "role": "button",
                "label": "Submit",
                "bounds": [10.0, 10.0, 50.0, 20.0],
            }
        ],
        "redacted_token_count": 0,
    }

    # No AUTH_HEADERS sent!
    response = client.post("/api/resolve-action", json=valid_payload)
    assert response.status_code == 200  # Should be allowed in demo mode
