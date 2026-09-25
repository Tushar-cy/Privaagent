from typing import List, Union
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
import json


class Settings(BaseSettings):
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    DEBUG: bool = False
    LOG_LEVEL: str = "info"
    SESSION_TOKEN: str = "sih_secure_session_v1"  # Mandatory session token to enforce client-server trust boundary

    # When set, CORS is restricted to this exact Chrome extension ID.
    # Leave empty to allow any chrome-extension:// origin (dev/CI mode only).
    # Example: ALLOWED_EXTENSION_ID=abcdefghijklmnopabcdefghijklmnop
    ALLOWED_EXTENSION_ID: str = ""

    # CORS configuration — chrome-extension:// origins are handled via allow_origin_regex in main.py.
    # Only localhost/loopback dev-server origins are listed here.
    CORS_ORIGINS: List[str] = [
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    # VLM configuration
    VLM_PROVIDER: str = "remote"
    VLM_MODEL_ID: str = "qwen2.5vl:3b-instruct-q4_K_M"
    VLM_API_BASE_URL: str = "http://localhost:11434/v1"
    VLM_API_KEY: str = "ollama"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            if v.startswith("[") and v.endswith("]"):
                try:
                    return json.loads(v)
                except Exception:
                    pass
            return [i.strip() for i in v.split(",") if i.strip()]
        return v

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()

