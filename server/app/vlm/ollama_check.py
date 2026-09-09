"""
Ollama Startup Health Check
Validates that Ollama is running and the configured model is available.
Called during server startup to surface clear setup errors.
"""

import httpx
import logging

logger = logging.getLogger("uvicorn.error")


async def check_ollama_availability(api_base_url: str, model_id: str) -> bool:
    """
    Checks if Ollama is running and the specified model is already pulled.
    Returns True if ready, False otherwise.
    Logs actionable instructions if setup is incomplete.
    """
    # Derive Ollama base from the v1 API URL
    # e.g. http://localhost:11434/v1 -> http://localhost:11434
    ollama_base = api_base_url.replace("/v1", "").rstrip("/")

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            # Check Ollama is running
            try:
                health_response = await client.get(f"{ollama_base}/api/tags")
            except httpx.ConnectError:
                logger.error(
                    "\n"
                    "╔══════════════════════════════════════════════════════════════╗\n"
                    "║  PRIVAAGENT: Ollama NOT RUNNING                              ║\n"
                    "╠══════════════════════════════════════════════════════════════╣\n"
                    "║  The VLM backend requires Ollama to be running locally.      ║\n"
                    "║                                                              ║\n"
                    "║  Fix:                                                        ║\n"
                    "║    1. Download Ollama: https://ollama.com/download           ║\n"
                    "║    2. Run in a terminal: ollama serve                        ║\n"
                    f"║    3. Pull the model:  ollama pull {model_id:<26}║\n"
                    "║    4. Restart this server                                    ║\n"
                    "╚══════════════════════════════════════════════════════════════╝\n"
                )
                return False

            if health_response.status_code != 200:
                logger.warning(f"[OllamaCheck] Unexpected health response: {health_response.status_code}")
                return False

            # Check if the model is already downloaded
            tags_data = health_response.json()
            available_models = [m.get("name", "") for m in tags_data.get("models", [])]

            # Normalize model name for comparison (remove :latest suffix for base match)
            model_base = model_id.split(":")[0]
            model_found = any(
                m == model_id or m.startswith(model_base + ":") or m == model_base
                for m in available_models
            )

            if not model_found:
                logger.warning(
                    "\n"
                    "╔══════════════════════════════════════════════════════════════╗\n"
                    "║  PRIVAAGENT: VLM Model NOT Downloaded                        ║\n"
                    "╠══════════════════════════════════════════════════════════════╣\n"
                    f"║  Model '{model_id}' is not available in Ollama.   \n"
                    "║                                                              ║\n"
                    "║  Fix (run in a new terminal):                                ║\n"
                    f"║    ollama pull {model_id:<49}║\n"
                    "║                                                              ║\n"
                    "║  Available models: " + ", ".join(available_models[:3] or ["none"]) + "\n"
                    "║  Server will start but VLM calls will fail until model       ║\n"
                    "║  is downloaded.                                              ║\n"
                    "╚══════════════════════════════════════════════════════════════╝\n"
                )
                return False

            logger.info(
                f"[OllamaCheck] ✓ Ollama running | Model '{model_id}' ready | "
                f"VLM endpoint: {ollama_base}"
            )
            return True

    except Exception as exc:
        logger.warning(f"[OllamaCheck] Unexpected error during health check: {exc}")
        return False
