"""
VLM Client for Open-Weight Reasoning Models
(Qwen2.5-VL-3B / Qwen2-VL-7B-Instruct / LLaVA-OneVision via Ollama)

No mock mode unless explicitly set via VLM_PROVIDER=mock in .env.
"""

import json
import re
import logging
from typing import Dict, Any, Optional
import httpx
from app.config import settings
from app.schemas.action import Action, ActionType
from app.schemas.disclosure import Disclosure
from app.vlm.prompts import VLM_SYSTEM_PROMPT, build_user_prompt

logger = logging.getLogger("uvicorn.error")


class VLMClient:
    def __init__(self):
        self.model_id = settings.VLM_MODEL_ID
        self.api_base_url = settings.VLM_API_BASE_URL
        self.provider = settings.VLM_PROVIDER

    def _extract_and_validate_json(
        self,
        raw_text: str,
        candidate_ids: list[str],
        model_used: Optional[str] = None,
        backend: Optional[str] = None,
    ) -> Action:
        """
        Strips markdown fences and validates JSON strictly against Action schema.
        Raises ValueError if VLM hallucinates a target_id not in the allowed candidate list.
        This is a security constraint: silent remapping could target the wrong element.
        """
        clean_text = raw_text.strip()
        # Remove markdown code fences if model accidentally wrapped output
        if clean_text.startswith("```"):
            clean_text = re.sub(r"^```(?:json)?\s*", "", clean_text)
            clean_text = re.sub(r"\s*```$", "", clean_text)

        try:
            data = json.loads(clean_text)
        except json.JSONDecodeError as err:
            raise ValueError(f"VLM response is not valid JSON: {raw_text}") from err

        # Set telemetry metadata if provided
        if model_used and "model_used" not in data:
            data["model_used"] = model_used
        if backend and "execution_backend" not in data:
            data["execution_backend"] = backend

        # Validate with Pydantic
        action = Action(**data)

        # SECURITY: Reject hallucinated target_ids — do NOT silently remap.
        # Silent remapping to candidate_ids[0] could target an unintended element,
        # violating the zero-trust model. The local validator will block/replan.
        if candidate_ids and action.target_id not in candidate_ids:
            raise ValueError(
                f"VLM hallucination detected: target_id '{action.target_id}' is not in the "
                f"allowed candidate list {candidate_ids}. Action rejected to prevent unintended targeting."
            )

        return action

    def _mock_response(self, disclosure: Disclosure, reason_prefix: str = "") -> Action:
        """
        Mock heuristic resolver — ONLY used when VLM_PROVIDER=mock is explicitly set.
        Never used as a silent fallback in production mode.
        """
        candidate_ids = [el.target_id for el in disclosure.elements]
        task_lower = (disclosure.task or "").lower()

        # Heuristic: if task mentions Q4 or bar, resolve to Q4 bar element
        q4_bar = next((id_ for id_ in candidate_ids if "q4" in id_.lower() or "bar_4" in id_.lower()), None)
        target = q4_bar or (candidate_ids[0] if candidate_ids else "unknown")

        mock_json = json.dumps({
            "action": "click",
            "target_id": target,
            "reason": f"{reason_prefix}Selected target '{target}' for task: '{disclosure.task}'",
            "confidence": 0.80,
            "model_used": f"Mock Heuristic Resolver ({self.model_id})",
            "execution_backend": "In-Memory Test Engine",
        })
        return self._extract_and_validate_json(
            mock_json,
            candidate_ids,
            model_used=f"Mock Heuristic Resolver ({self.model_id})",
            backend="In-Memory Test Engine",
        )

    async def predict_action(self, disclosure: Disclosure) -> Action:
        """
        Submits sanitized disclosure to VLM and returns a strictly validated Action.
        """
        candidate_ids = [el.target_id for el in disclosure.elements]

        # ── Explicit Mock Mode ─────────────────────────────────────────────────
        # Only activated when VLM_PROVIDER=mock is explicitly set in .env.
        # This is NOT a silent fallback — it is an intentional development mode.
        if self.provider == "mock":
            logger.warning(
                "[VLMClient] Running in MOCK mode (VLM_PROVIDER=mock). "
                "Set VLM_PROVIDER=remote and start Ollama for real VLM reasoning."
            )
            return self._mock_response(disclosure, reason_prefix="[MOCK] ")

        # ── Real VLM via Ollama / OpenAI-compatible endpoint ───────────────────
        if not self.api_base_url:
            raise RuntimeError(
                "VLM_API_BASE_URL is not configured. "
                "Please set VLM_API_BASE_URL=http://localhost:11434/v1 in server/.env "
                "and start Ollama with: ollama serve"
            )

        elements_summary = "\n".join(
            [f"- ID: {el.target_id} | Role: {el.role} | Label: {el.label}" for el in disclosure.elements]
        )

        crop_info = ""
        if disclosure.crop_box:
            crop_info = f"Bounding Box ROI: {disclosure.crop_box}"

        disc_level = disclosure.level.value if hasattr(disclosure.level, "value") else str(disclosure.level)
        user_prompt = build_user_prompt(
            disclosure.task or "Navigate to target",
            elements_summary,
            crop_info,
            level=disc_level,
        )

        try:
            async with httpx.AsyncClient(timeout=45.0) as client:
                user_content: Any = user_prompt
                if disclosure.screenshot_data:
                    img_url = disclosure.screenshot_data
                    if not img_url.startswith("data:"):
                        img_url = f"data:image/png;base64,{img_url}"
                    user_content = [
                        {"type": "text", "text": user_prompt},
                        {"type": "image_url", "image_url": {"url": img_url}},
                    ]

                payload = {
                    "model": self.model_id,
                    "messages": [
                        {"role": "system", "content": VLM_SYSTEM_PROMPT},
                        {"role": "user", "content": user_content},
                    ],
                    "temperature": 0.1,
                    "response_format": {"type": "json_object"},
                }

                headers = {"Content-Type": "application/json"}
                if settings.VLM_API_KEY and settings.VLM_API_KEY != "ollama":
                    headers["Authorization"] = f"Bearer {settings.VLM_API_KEY}"

                response = await client.post(
                    f"{self.api_base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                )

                if response.status_code != 200:
                    raise RuntimeError(
                        f"VLM API returned status {response.status_code}: {response.text}"
                    )

                res_data = response.json()
                raw_content = res_data["choices"][0]["message"]["content"]
                actual_model = res_data.get("model", self.model_id)
                return self._extract_and_validate_json(
                    raw_content,
                    candidate_ids,
                    model_used=f"{actual_model} (Open-Weight VLM)",
                    backend=f"Remote VLM ({self.api_base_url})",
                )

        except httpx.ConnectError:
            raise RuntimeError(
                f"Cannot connect to VLM endpoint at {self.api_base_url}. "
                f"Please ensure Ollama is running: 'ollama serve' "
                f"and the model is available: 'ollama pull {self.model_id}'"
            )
        except httpx.TimeoutException:
            raise RuntimeError(
                f"VLM inference timed out after 45s. The model '{self.model_id}' may be too large "
                f"for your hardware. Try a smaller model: 'ollama pull qwen2.5vl:3b-instruct-q4_K_M'"
            )
