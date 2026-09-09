from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.api.routes import router as api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: validate Ollama availability if using remote VLM provider."""
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
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o for o in settings.CORS_ORIGINS if not o.startswith("chrome-extension:")],
    allow_origin_regex=r"^chrome-extension://.*$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=settings.DEBUG)
