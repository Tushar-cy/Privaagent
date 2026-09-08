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

        # Enforce target_id constraint: must be one of candidate_ids
        if candidate_ids and action.target_id not in candidate_ids:
            # If target_id was hallucinated, map to closest candidate
            fallback_target = candidate_ids[0]
            action.reason = f"[Re-mapped from invalid ID '{action.target_id}']: {action.reason}"
            action.target_id = fallback_target

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

        user_prompt = build_user_prompt(disclosure.task or "Navigate to target", elements_summary, crop_info)

        # 1. Mock / Demo Mode
        if self.provider == "mock" or not self.api_base_url:
            # Intelligent mock heuristic for demo/testing
            task_lower = (disclosure.task or "").toLowerCase() if hasattr(str, "toLowerCase") else (disclosure.task or "").lower()

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

        # 2. Remote Hosted Endpoint (e.g. vLLM / OpenAI-compatible endpoint hosting Qwen2-VL)
        async with httpx.AsyncClient(timeout=30.0) as client:
            payload = {
                "model": self.model_id,
                "messages": [
                    {"role": "system", "content": VLM_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
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
