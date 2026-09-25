"""
Server-Side Defense-in-Depth Sanitization Inspector
Validates that incoming Disclosure payloads NEVER contain raw, unredacted PII.
"""

import re
import math
from collections import Counter
from typing import List, Tuple
from fastapi import HTTPException
from fastapi import status as http_status
from app.schemas.disclosure import Disclosure

# Sensitive patterns that must never cross the trust boundary unredacted
LEAK_PATTERNS = [
    ("PAN", re.compile(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b")),
    ("AADHAAR", re.compile(r"(?<!\d)[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}(?!\d)")),
    ("EMAIL", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")),
    ("PHONE", re.compile(r"(?<!\d)(?:(?:\+91|0)[\s-]?)?[6-9](?:[\s-]?\d){8,9}\b|\+[1-9]\d{0,2}[\s-]?(?:\(?\d{2,4}\)?[\s-]?)?\d{3,4}[\s-]?\d{3,4}\b")),
    ("GSTIN", re.compile(r"\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b")),
    ("DRIVING_LICENSE", re.compile(r"\b[A-Z]{2}[-\s]?[0-9]{2}[-\s]?[0-9]{4}[-\s]?[0-9]{7}\b|\b[A-Z]{2}[0-9]{13,15}\b")),
    ("BANK_ACCOUNT", re.compile(r"(?:\b(?:A\/C|Account|Acc|Bank\s+Account|Account\s+No|A\/C\s+No)\s*(?:No\.?|Number|#)?\s*[:=-]?\s*)(\d{9,18})\b", re.IGNORECASE)),
    ("UPI_ID", re.compile(r"\b[a-zA-Z0-9.\-_]{2,64}@(okhdfcbank|okaxis|oksbi|paytm|upi|ybl|axl|ibl|apl|icici|kotak|barodampay|postbank|axisbank|sbi|hdfcbank)\b", re.IGNORECASE)),
    ("IFSC", re.compile(r"\b[A-Z]{4}0[A-Z0-9]{6}\b")),
    ("PASSPORT_IN", re.compile(r"\b[A-Z][1-9][0-9]{6}\b")),
    ("VOTER_ID", re.compile(r"\b[A-Z]{3}[0-9]{7}\b")),
    ("CREDIT_CARD", re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")),
    ("DOB", re.compile(r"\b(?:DOB|Date\s+of\s+Birth|Birth\s+Date|Born\s+on)\s*[:=-]?\s*(?:\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\b", re.IGNORECASE)),
    ("VEHICLE_RC", re.compile(r"\b[A-Z]{2}[-\s]?[0-9]{1,2}[-\s]?[A-Z]{1,3}[-\s]?[0-9]{4}\b", re.IGNORECASE)),
    ("IPV4", re.compile(r"\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b")),
    ("IPV6", re.compile(r"\b(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}\b")),
]

_VERHOEFF_D = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9), (1, 2, 3, 4, 0, 6, 7, 8, 9, 5),
    (2, 3, 4, 0, 1, 7, 8, 9, 5, 6), (3, 4, 0, 1, 2, 8, 9, 5, 6, 7),
    (4, 0, 1, 2, 3, 9, 5, 6, 7, 8), (5, 9, 8, 7, 6, 0, 4, 3, 2, 1),
    (6, 5, 9, 8, 7, 1, 0, 4, 3, 2), (7, 6, 5, 9, 8, 2, 1, 0, 4, 3),
    (8, 7, 6, 5, 9, 3, 2, 1, 0, 4), (9, 8, 7, 6, 5, 4, 3, 2, 1, 0),
)
_VERHOEFF_P = (
    (0, 1, 2, 3, 4, 5, 6, 7, 8, 9), (1, 5, 7, 6, 2, 8, 3, 0, 9, 4),
    (5, 8, 0, 3, 7, 9, 6, 1, 4, 2), (8, 9, 1, 6, 0, 4, 3, 5, 2, 7),
    (9, 4, 5, 3, 1, 2, 6, 8, 7, 0), (4, 2, 8, 6, 5, 7, 3, 9, 0, 1),
    (2, 7, 9, 3, 8, 0, 6, 4, 1, 5), (7, 0, 4, 6, 9, 1, 3, 2, 5, 8),
)


def _valid_verhoeff(value: str) -> bool:
    digits = re.sub(r"\D", "", value)
    if len(digits) != 12 or len(set(digits)) == 1:
        return False
    checksum = 0
    for index, digit in enumerate(reversed(digits)):
        checksum = _VERHOEFF_D[checksum][_VERHOEFF_P[index % 8][int(digit)]]
    return checksum == 0


def _valid_luhn(value: str) -> bool:
    digits = re.sub(r"\D", "", value)
    if not 13 <= len(digits) <= 19:
        return False
    total = 0
    double = False
    for digit in reversed(digits):
        number = int(digit)
        if double:
            number *= 2
            if number > 9:
                number -= 9
        total += number
        double = not double
    return total % 10 == 0


def _pattern_match_is_valid(pii_type: str, value: str, full_text: str, start: int) -> bool:
    if pii_type == "AADHAAR":
        prefix = full_text[max(0, start - 6):start]
        suffix = full_text[start + len(value):start + len(value) + 6]
        return (
            _valid_verhoeff(value)
            and re.search(r"\d+[\s-]*$", prefix) is None
            and re.match(r"^[\s-]*\d+", suffix) is None
        )
    if pii_type == "CREDIT_CARD":
        return _valid_luhn(value)
    if pii_type == "PHONE":
        digits = re.sub(r"\D", "", value)
        prefix = full_text[max(0, start - 4):start]
        suffix = full_text[start + len(value):start + len(value) + 4]
        return (
            9 <= len(digits) <= 14
            and re.search(r"\d+[\s-]*$", prefix) is None
            and re.match(r"^[\s-]*\d+", suffix) is None
        )
    if pii_type == "IPV4":
        try:
            return len(value.split(".")) == 4 and all(0 <= int(part) <= 255 for part in value.split("."))
        except ValueError:
            return False
    if pii_type == "IPV6":
        try:
            parts = value.split(":")
            return len(parts) == 8 and all(1 <= len(part) <= 4 and int(part, 16) >= 0 for part in parts)
        except ValueError:
            return False
    return True

# Keep the server boundary aligned with the client secret detector's known
# provider prefixes, key/value patterns, and entropy heuristic.
SECRET_PREFIXES = (
    ("sk-ant-", 20), ("sk-", 16), ("ghp_", 16), ("gho_", 16),
    ("ghs_", 16), ("ghr_", 16), ("glpat-", 16), ("AKIA", 20),
    ("ASIA", 20), ("xoxb-", 16), ("xoxp-", 16), ("xapp-", 16),
    ("AIza", 20), ("ya29.", 20), ("eyJ", 50), ("npm_", 36),
    ("AC", 32), ("pk_", 16), ("rk_", 16), ("hf_", 16),
)
SECRET_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_.-]{8,}")
KEY_VALUE_SECRET_PATTERN = re.compile(
    r"(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|secret[_-]?key|"
    r"client[_-]?secret|private[_-]?key|token)\s*[=:]\s*([A-Za-z0-9_.-]{16,})",
    re.IGNORECASE,
)
JSON_SECRET_PATTERN = re.compile(
    r"\"(?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|secret[_-]?key|"
    r"client[_-]?secret|token)\"\s*:\s*\"([A-Za-z0-9_.-]{16,})\"",
    re.IGNORECASE,
)
BEARER_SECRET_PATTERN = re.compile(r"(?:authorization\s*:\s*)?(?:bearer|token)\s+([A-Za-z0-9_.-]{16,})", re.IGNORECASE)


def _entropy(value: str) -> float:
    if not value:
        return 0.0
    counts = Counter(value)
    length = len(value)
    return -sum((count / length) * math.log2(count / length) for count in counts.values())


def _contains_secret(text: str) -> bool:
    for pattern in (KEY_VALUE_SECRET_PATTERN, JSON_SECRET_PATTERN, BEARER_SECRET_PATTERN):
        if pattern.search(text):
            return True

    for match in SECRET_TOKEN_PATTERN.finditer(text):
        token = match.group(0)
        lowered = token.lower()
        if any(lowered.startswith(prefix.lower()) and len(token) >= min_length for prefix, min_length in SECRET_PREFIXES):
            return True

        entropy = _entropy(token)
        has_numbers = any(character.isdigit() for character in token)
        has_letters = any(character.isalpha() for character in token)
        has_mixed_case = any(character.islower() for character in token) and any(character.isupper() for character in token)
        is_hex = re.fullmatch(r"[0-9a-fA-F]{32,}", token) is not None
        if entropy >= 3.3 and len(token) >= 24 and has_numbers and has_letters and (has_mixed_case or is_hex or len(token) >= 32):
            return True
    return False


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
        texts_to_check.append((f"element:{el.target_id}:target_id", el.target_id))
        texts_to_check.append((f"element:{el.target_id}:label", el.label))

    for field_name, text in texts_to_check:
        for pii_type, pattern in LEAK_PATTERNS:
            match = pattern.search(text)
            if match:
                matched_str = match.group(0)
                if not _pattern_match_is_valid(pii_type, matched_str, text, match.start()):
                    continue
                # Ensure it's not already an anonymized token like [EMAIL_1]
                if matched_str.startswith("[") and matched_str.endswith("]"):
                    continue

                raise HTTPException(
                    status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        f"Defense-in-depth violation: Unredacted {pii_type} pattern "
                        f"detected in field '{field_name}'. All sensitive data must be "
                        "masked on-device prior to network transmission."
                    ),
                )

        if _contains_secret(text):
            raise HTTPException(
                status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Defense-in-depth violation: Unredacted SECRET_KEY pattern "
                    f"detected in field '{field_name}'. All secrets must be masked "
                    "on-device prior to network transmission."
                ),
            )
