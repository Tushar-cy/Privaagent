# VLM client interface for open-weight models (Qwen2-VL, LLaVA-OneVision)
import json
from typing import Dict, Any
from app.config import settings


class VLMClient:
    def __init__(self):
        self.model_id = settings.VLM_MODEL_ID
        self.api_base_url = settings.VLM_API_BASE_URL

    async def predict_action(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Submits sanitized context to VLM and expects strictly formatted Action JSON.
        """
        if settings.VLM_PROVIDER == "mock":
            # Default mock prediction for contract testing
            return {
                "action": "click",
                "target_id": payload.get("elements", [{}])[0].get("target_id", "fallback_id"),
                "reason": "Predicted optimal action from sanitized visual/semantic context",
                "confidence": 0.92,
            }
        # Production implementation will connect to self-hosted vLLM/Ollama/TGI endpoint
        raise NotImplementedError(f"Provider {settings.VLM_PROVIDER} not yet implemented.")
