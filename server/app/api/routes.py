from fastapi import APIRouter, HTTPException, status
from app.schemas.disclosure import Disclosure
from app.schemas.action import Action
from app.security.sanitizer_check import verify_disclosure_sanitization
from app.vlm.client import VLMClient

router = APIRouter()
vlm_client = VLMClient()


@router.get("/health", status_code=status.HTTP_200_OK)
async def health_check():
    return {
        "status": "ok",
        "service": "Privaagent Minimum-Disclosure Core",
        "version": "0.1.0",
    }


@router.post("/resolve-action", response_model=Action, status_code=status.HTTP_200_OK)
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
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
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
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"VLM reasoning engine failed: {str(err)}",
        )
