from fastapi import APIRouter, HTTPException, status
from app.schemas.disclosure import Disclosure
from app.schemas.action import Action, ActionType

router = APIRouter()


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
    Fallback endpoint called when client cannot solve locally.
    Accepts ONLY sanitized/minimum-disclosure context.
    Returns structured Action referencing an existing target_id.
    """
    # Defense-in-depth: check if elements list is empty
    if not disclosure.elements:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Disclosure payload contains no elements to act upon.",
        )

    # In Prompt 0 bootstrap mode, return a safe mock resolution to verify contract wiring
    target = disclosure.elements[0]
    return Action(
        action=ActionType.CLICK,
        target_id=target.target_id,
        reason=f"Resolved via {disclosure.level} disclosure for task: {disclosure.task or 'unspecified'}",
        confidence=0.95,
    )
