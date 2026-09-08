"""
VLM Client for Open-Weight Reasoning Models
(Qwen2-VL-7B-Instruct / LLaVA-OneVision)
"""

import json
import re
from typing import Dict, Any, Optional
import httpx
from app.config import settings
from app.schemas.action import Action, ActionType
from app.schemas.disclosure import Disclosure
from app.vlm.prompts import VLM_SYSTEM_PROMPT, build_user_prompt


class VLMClient:
    def __init__(self):
        self.model_id = settings.VLM_MODEL_ID
        self.api_base_url = settings.VLM_API_BASE_URL
        self.provider = settings.VLM_PROVIDER

    def _extract_and_validate_json(self, raw_text: str, candidate_ids: list[str]) -> Action:
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

        # Validate with Pydantic
        action = Action(**data)

        # SECURITY FIX: Reject hallucinated target_ids — do NOT silently remap.
        # Silent remapping to candidate_ids[0] could target an unintended element,
        # which violates the zero-trust model. The local validator will block/replan.
        if candidate_ids and action.target_id not in candidate_ids:
            raise ValueError(
                f"VLM hallucination detected: target_id '{action.target_id}' is not in the "
                f"allowed candidate list {candidate_ids}. Action rejected to prevent unintended targeting."
            )

        return action

    async def predict_action(self, disclosure: Disclosure) -> Action:
        """
        Submits sanitized disclosure to VLM and returns a strictly validated Action.
        """
        candidate_ids = [el.target_id for el in disclosure.elements]

        # Prepare summary of available candidates
        elements_summary = "\n".join(
            [f"- ID: {el.target_id} | Role: {el.role} | Label: {el.label}" for el in disclosure.elements]
        )

        crop_info = ""
        if disclosure.crop_box:
            crop_info = f"Bounding Box ROI: {disclosure.crop_box}"

        disc_level = disclosure.level.value if hasattr(disclosure.level, "value") else str(disclosure.level)
        user_prompt = build_user_prompt(disclosure.task or "Navigate to target", elements_summary, crop_info, level=disc_level)

        # 1. Mock / Demo Mode
        if self.provider == "mock" or not self.api_base_url:
            # Intelligent mock heuristic for demo/testing
            task_lower = (disclosure.task or "").lower()

            # If task mentions Q4 or bar, resolve to Q4 bar
            q4_bar = next((id_ for id_ in candidate_ids if "q4" in id_.lower() or "bar_4" in id_.lower()), None)
            target = q4_bar or (candidate_ids[0] if candidate_ids else "btn-open-invoice")

            mock_json = json.dumps({
                "action": "click",
                "target_id": target,
                "reason": f"Selected optimal target '{target}' to fulfill task: '{disclosure.task}'",
                "confidence": 0.95,
            })
            return self._extract_and_validate_json(mock_json, candidate_ids)

        # 2. Remote Hosted Endpoint (e.g. vLLM / Ollama / OpenAI-compatible endpoint hosting Qwen2-VL)
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                user_content: Any = user_prompt
                if disclosure.screenshot_data:  # FIX: was disclosure.image_data (field name mismatch)
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
                if settings.VLM_API_KEY:
                    headers["Authorization"] = f"Bearer {settings.VLM_API_KEY}"

                response = await client.post(
                    f"{self.api_base_url}/chat/completions",
                    json=payload,
                    headers=headers,
                )

                if response.status_code != 200:
                    raise RuntimeError(f"VLM API returned status {response.status_code}: {response.text}")

                res_data = response.json()
                raw_content = res_data["choices"][0]["message"]["content"]
                return self._extract_and_validate_json(raw_content, candidate_ids)
        except (httpx.ConnectError, httpx.TimeoutException, RuntimeError) as err:
            if settings.DEBUG:
                import logging
                logging.getLogger("uvicorn.error").warning(
                    f"[VLMClient] Remote endpoint unreachable or returned error ({err}). "
                    f"Falling back to mock heuristic (DEBUG mode active)."
                )
                task_lower = (disclosure.task or "").lower()
                q4_bar = next((id_ for id_ in candidate_ids if "q4" in id_.lower() or "bar_4" in id_.lower()), None)
                target = q4_bar or (candidate_ids[0] if candidate_ids else "btn-open-invoice")
                mock_json = json.dumps({
                    "action": "click",
                    "target_id": target,
                    "reason": f"[Fallback Mock] Selected optimal target '{target}' to fulfill task: '{disclosure.task}'",
                    "confidence": 0.95,
                })
                return self._extract_and_validate_json(mock_json, candidate_ids)
            raise

