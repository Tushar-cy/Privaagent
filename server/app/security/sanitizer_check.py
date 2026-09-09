"""
Server-Side Defense-in-Depth Sanitization Inspector
Validates that incoming Disclosure payloads NEVER contain raw, unredacted PII.
"""

import re
from typing import List, Tuple
from fastapi import HTTPException, status
from app.schemas.disclosure import Disclosure

# Sensitive patterns that must never cross the trust boundary unredacted
LEAK_PATTERNS = [
    ("PAN", re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b")),
    ("AADHAAR", re.compile(r"\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b")),
    ("EMAIL", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")),
    ("PHONE", re.compile(r"(?:(?:\+91|0)[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b")),
    ("GSTIN", re.compile(r"\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b")),
    ("DRIVING_LICENSE", re.compile(r"\b[A-Z]{2}[-\s]?[0-9]{2}[-\s]?[0-9]{4}[-\s]?[0-9]{7}\b")),
    ("BANK_ACCOUNT", re.compile(r"(?:\b(?:A\/C|Account|Acc|Bank\s+Account|Account\s+No|A\/C\s+No)\s*(?:No\.?|Number|#)?\s*[:=-]?\s*)(\d{9,18})\b", re.IGNORECASE)),
    ("SECRET_KEY", re.compile(r"\b(?:sk-|ghp_|AKIA|AIzaSy|ya29\.)[a-zA-Z0-9_\-]{14,}\b")),
    ("UPI_ID", re.compile(r"\b[a-zA-Z0-9.\-_]{2,64}@(okhdfcbank|okaxis|oksbi|paytm|upi|ybl|axl|ibl|apl|icici|kotak)\b", re.IGNORECASE)),
    ("IFSC", re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b")),
    ("PASSPORT_IN", re.compile(r"\b[A-Z][1-9][0-9]{6}\b")),
    ("VOTER_ID", re.compile(r"\b[A-Z]{3}[0-9]{7}\b")),
]


def verify_disclosure_sanitization(disclosure: Disclosure) -> None:
    """
    Scans all disclosed element labels and metadata for leaked raw PII.
    Raises HTTP 422 if any unsanitized pattern is detected.
    """
    texts_to_check: List[Tuple[str, str]] = []

    if disclosure.reason:
        texts_to_check.append(("reason", disclosure.reason))
    if disclosure.task:
        texts_to_check.append(("task", disclosure.task))

    for el in disclosure.elements:
        texts_to_check.append((f"element:{el.target_id}:label", el.label))

    for field_name, text in texts_to_check:
        for pii_type, pattern in LEAK_PATTERNS:
            match = pattern.search(text)
            if match:
                matched_str = match.group(0)
                # Ensure it's not already an anonymized token like [EMAIL_1]
                if matched_str.startswith("[") and matched_str.endswith("]"):
                    continue

                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        f"Defense-in-depth violation: Unredacted {pii_type} pattern "
                        f"detected in field '{field_name}' ('{matched_str[:4]}...'). "
                        "All PII must be masked on-device prior to network transmission."
                    ),
                )
