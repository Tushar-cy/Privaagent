from typing import List, Union
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
import json


class Settings(BaseSettings):
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    DEBUG: bool = True
    LOG_LEVEL: str = "info"

    # CORS configuration - restricted to extension origins and local dev servers
    CORS_ORIGINS: List[str] = [
        "chrome-extension://*",
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
