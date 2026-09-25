"""Regression coverage for the server-side L2/L3 visual disclosure contract."""
import base64
import struct
import sys
import zlib
from pathlib import Path

import pytest

SERVER_PATH = Path(__file__).parent.parent / "server"
sys.path.insert(0, str(SERVER_PATH))

from fastapi.testclient import TestClient
from app.main import app


client = TestClient(app)
AUTH_HEADERS = {"X-Privaagent-Session-Token": "ci-test-token-privaagent"}


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(kind + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", crc)


def _valid_png_data_url() -> str:
    """Build a tiny valid RGBA PNG without relying on an image library."""
    png = bytearray(b"\x89PNG\r\n\x1a\n")
    png.extend(_png_chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 6, 0, 0, 0)))
    png.extend(_png_chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00\xff")))
    png.extend(_png_chunk(b"IEND", b""))
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def _manifest(source_count=0, intersecting_count=0, redacted_count=0, boxes=None):
    return {
        "sourceSensitiveBoxCount": source_count,
        "intersectingBoxCount": intersecting_count,
        "redactedBoxCount": redacted_count,
        "redactedBoxes": boxes if boxes is not None else [],
    }


def _visual_payload(level: str, **overrides):
    payload = {
        "level": level,
        "reason": "Visual reasoning is required",
        "task": "Open the report",
        "elements": [
            {"target_id": "report-button", "role": "button", "label": "Open report"}
        ],
        "screenshot_data": _valid_png_data_url(),
        "redaction_manifest": _manifest(),
    }
    payload.update(overrides)
    return payload


@pytest.mark.parametrize("level", ["L2", "L3"])
def test_visual_disclosure_requires_screenshot(level):
    payload = _visual_payload(level, screenshot_data=None)

    response = client.post("/api/resolve-action", json=payload, headers=AUTH_HEADERS)

    assert response.status_code == 422


@pytest.mark.parametrize("level", ["L2", "L3"])
def test_visual_disclosure_requires_manifest(level):
    payload = _visual_payload(level, redaction_manifest=None)

    response = client.post("/api/resolve-action", json=payload, headers=AUTH_HEADERS)

    assert response.status_code == 422


@pytest.mark.parametrize("level", ["L2", "L3"])
def test_visual_disclosure_rejects_manifest_count_mismatch(level):
    payload = _visual_payload(
        level,
        redaction_manifest=_manifest(
            source_count=2,
            intersecting_count=1,
            redacted_count=1,
            boxes=[[10, 20, 30, 40]],
        ),
    )

    response = client.post("/api/resolve-action", json=payload, headers=AUTH_HEADERS)

    assert response.status_code == 422


@pytest.mark.parametrize("level", ["L2", "L3"])
def test_visual_disclosure_rejects_invalid_png(level):
    payload = _visual_payload(level, screenshot_data="data:image/png;base64,aGVsbG8=")

    response = client.post("/api/resolve-action", json=payload, headers=AUTH_HEADERS)

    assert response.status_code == 422


@pytest.mark.parametrize("level", ["L2", "L3"])
def test_visual_disclosure_accepts_valid_screenshot_and_manifest(level, monkeypatch):
    from app.api import routes

    monkeypatch.setattr(routes.vlm_client, "provider", "mock")
    payload = _visual_payload(level)

    response = client.post("/api/resolve-action", json=payload, headers=AUTH_HEADERS)

    assert response.status_code == 200, response.text
    assert response.json()["target_id"] == "report-button"
