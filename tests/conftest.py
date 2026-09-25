"""
conftest.py — Session-level environment setup for pytest.

Sets SESSION_TOKEN and VLM_PROVIDER BEFORE any app module is imported.
pydantic-settings reads from os.environ at Settings() instantiation time,
so this must run in pytest_configure (the very first hook, before collection).
"""
import os


def pytest_configure(config):
    """Inject CI-safe environment variables before any test module is imported."""
    # Use setdefault so a real .env file or CI job env can override these.
    os.environ.setdefault("SESSION_TOKEN", "ci-test-token-privaagent")
    os.environ.setdefault("VLM_PROVIDER", "mock")
