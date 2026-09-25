from contextlib import asynccontextmanager
import ipaddress
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api.routes import router as api_router
from app.request_size_limit import RequestBodySizeLimitMiddleware


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Validate deployment auth and VLM settings before serving requests."""
    if settings.SESSION_TOKEN == "change-this-for-local-evaluation":
        bind_host = settings.HOST.strip().strip("[]").lower()
        try:
            is_loopback = ipaddress.ip_address(bind_host).is_loopback
        except ValueError:
            is_loopback = bind_host == "localhost" or bind_host.endswith(".localhost")
        if not is_loopback:
            raise RuntimeError(
                "Refusing to bind the API beyond loopback while SESSION_TOKEN uses the demo sentinel. "
                "Set a unique SESSION_TOKEN before exposing the backend."
            )

    if settings.VLM_PROVIDER != "mock":
        from app.vlm.ollama_check import check_ollama_availability
        await check_ollama_availability(settings.VLM_API_BASE_URL, settings.VLM_MODEL_ID)
    else:
        import logging
        logging.getLogger("uvicorn.error").warning(
            "[Privaagent] VLM_PROVIDER=mock — running with heuristic mock responses. "
            "Set VLM_PROVIDER=remote and start Ollama for real intelligence."
        )
    yield


app = FastAPI(
    title="Privaagent VLM Fallback API",
    description="Backend service for Adaptive Minimum-Disclosure Browser Agent (SIH26171)",
    version="0.1.0",
    lifespan=lifespan,
)

# Configure CORS for Chrome extension origins & local dev
# When ALLOWED_EXTENSION_ID is set, restrict to that exact extension (production).
# When unset, allow any chrome-extension:// origin (dev/CI convenience).
_ext_id = settings.ALLOWED_EXTENSION_ID.strip()
_chrome_ext_regex = (
    rf"^chrome-extension://{_ext_id}$"
    if _ext_id
    else r"^chrome-extension://[a-z]{32}$"  # Any valid 32-char extension ID
)

# This middleware is registered before CORS so CORS remains the outer layer and
# can add the expected headers to early 413 responses.
app.add_middleware(RequestBodySizeLimitMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=_chrome_ext_regex,
    allow_credentials=True,
    allow_methods=["POST", "GET", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Privaagent-Session-Token"],
)



@app.get("/health")
async def root_health():
    return {
        "status": "ok",
        "vlm_provider": settings.VLM_PROVIDER,
        "vlm_model": settings.VLM_MODEL_ID,
    }


# Mount API routes
app.include_router(api_router, prefix="/api")

# Mount Static Demonstration and Benchmark Directories
from pathlib import Path
from fastapi.staticfiles import StaticFiles

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
demo_path = ROOT_DIR / "demo"
if demo_path.exists():
    app.mount("/demo", StaticFiles(directory=str(demo_path), html=True), name="demo")

benchmark_path = ROOT_DIR / "benchmark"
if benchmark_path.exists():
    app.mount("/benchmark", StaticFiles(directory=str(benchmark_path), html=True), name="benchmark")

extension_path = ROOT_DIR / "extension"
if extension_path.exists():
    app.mount("/extension", StaticFiles(directory=str(extension_path)), name="extension")

privaagent_ext_path = ROOT_DIR / "privaagent-extension"
if privaagent_ext_path.exists():
    app.mount("/privaagent-extension", StaticFiles(directory=str(privaagent_ext_path)), name="privaagent-extension")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
