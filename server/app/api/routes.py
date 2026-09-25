from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException
from fastapi import status as http_status
from app.config import settings
from app.schemas.disclosure import Disclosure
from app.schemas.action import Action
from app.security.sanitizer_check import verify_disclosure_sanitization
from app.vlm.client import VLMClient

router = APIRouter()
vlm_client = VLMClient()


async def verify_session_token(
    x_privaagent_session_token: Optional[str] = Header(default=None),
    authorization: Optional[str] = Header(default=None),
):
    """Enforces session bearer authentication when SESSION_TOKEN is configured."""
    if settings.SESSION_TOKEN:
        token = x_privaagent_session_token
        if not token and authorization and authorization.startswith("Bearer "):
            token = authorization.split("Bearer ", 1)[1].strip()
        if token != settings.SESSION_TOKEN:
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
    except Exception as err:
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"VLM reasoning engine failed: {str(err)}",
        )
