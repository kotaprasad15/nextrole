"""Central configuration, loaded from environment / .env.

Design decision: every tunable (model names, budgets, timeouts, prices) lives here so
no agent hardcodes a model and caps can be changed without touching code.
"""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    anthropic_api_key: str = ""
    model_fast: str = "claude-haiku-5-5"
    model_strong: str = "claude-sonnet-5-5"

    price_in_per_mtok: float = 3.0
    price_out_per_mtok: float = 15.0
    run_max_cost_usd: float = 0.50
    run_max_tokens: int = 200_000

    llm_timeout_s: float = 60.0
    llm_max_retries: int = 3
    trace_dir: Path = Path("traces")


@lru_cache
def get_settings() -> Settings:
    return Settings()
