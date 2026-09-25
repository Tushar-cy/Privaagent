from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi import status as http_status
import logging
from app.config import settings
from app.schemas.disclosure import Disclosure
from app.schemas.action import Action
from app.security.sanitizer_check import verify_disclosure_sanitization
from app.vlm.client import VLMClient

logger = logging.getLogger("privaagent.auth")

# Sentinel value: when SESSION_TOKEN equals this string the server is in demo/dev mode.
# A real crypto token (sih_<uuid>) can never accidentally match this.
_DEMO_SENTINEL = "change-this-for-local-evaluation"

router = APIRouter()
vlm_client = VLMClient()


async def verify_session_token(
    x_privaagent_session_token: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
):
    """Enforces session bearer authentication.

    Two modes:
    - DEMO mode  (SESSION_TOKEN == sentinel): requests are allowed; a warning is logged.
      Copy the extension's token from its DevTools console to server/.env to enable enforcement.
    - ENFORCED mode (SESSION_TOKEN is a real token): token must match exactly or 401 is raised.
    """
    configured_token = settings.SESSION_TOKEN

    if configured_token == _DEMO_SENTINEL:
        # Demo/dev mode — allow the request but warn loudly so it's visible in server logs
        logger.warning(
            "[Privaagent Auth] Running in DEMO MODE — SESSION_TOKEN is the default sentinel. "
            "Copy your extension's generated token to server/.env to enforce authentication."
        )
        return  # allow

    # Enforced mode — require exact token match
    token = x_privaagent_session_token
    if not token and authorization and authorization.startswith("Bearer "):
        token = authorization.split("Bearer ", 1)[1].strip()
    if token != configured_token:
        raise HTTPException(
            status_code=http_status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: invalid or missing Privaagent session authentication token.",
        )


@router.get("/health", status_code=http_status.HTTP_200_OK)
async def health_check():
    return {
        "status": "ok",
        "service": "Privaagent Minimum-Disclosure Core",
        "version": "0.1.0",
    }


@router.get("/token-status", status_code=http_status.HTTP_200_OK)
async def token_status():
    """Returns the current session authentication mode without revealing the token value.
    The extension popup calls this to show pairing state to SIH judges.
    """
    is_demo = settings.SESSION_TOKEN == _DEMO_SENTINEL
    return {
        "auth_mode": "demo" if is_demo else "enforced",
        "paired": not is_demo,
        "instructions": (
            "Demo mode: any extension token is accepted. "
            "For enforced mode, read privaagent_session_token from chrome.storage.local in the Privaagent extension's DevTools console, "
            "then set SESSION_TOKEN in server/.env and restart the backend."
        ) if is_demo else "Enforced mode: only the configured extension token is accepted.",
    }


@router.post(
    "/resolve-action",
    response_model=Action,
    status_code=http_status.HTTP_200_OK,
    dependencies=[Depends(verify_session_token)],
)
async def resolve_action(disclosure: Disclosure):
    """
    Fallback reasoning endpoint called when client cannot solve locally.
    Accepts ONLY sanitized/minimum-disclosure context.
    Performs defense-in-depth sanitization checks, invokes open-weight VLM,
    and returns a structured Action referencing a valid target_id.
    """
    # 1. Structural validation
    if not disclosure.elements and disclosure.level != "L0":
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Disclosure payload contains no candidate elements to act upon.",
        )

    # 2. Defense-in-depth: Reject any leaked unredacted PII/secrets
    verify_disclosure_sanitization(disclosure)

    # 3. Invoke Open-Weight VLM with strict JSON Action constraints
    try:
        action = await vlm_client.predict_action(disclosure)
        return action
    except Exception:
        logger.exception("VLM reasoning service failed while resolving an action.")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="VLM reasoning service unavailable.",
        )
