"""Central configuration, loaded from environment / .env.

Design decision: every tunable (model names, budgets, timeouts, prices) lives here so
no agent hardcodes a model and caps can be changed without touching code.
"""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Holds the key for whichever Anthropic-compatible endpoint is used (Anthropic by default).
    anthropic_api_key: str = ""
    # Empty = official Anthropic API. Set to use another Anthropic-compatible provider, e.g.
    # DeepSeek: https://api.deepseek.com/anthropic (then also set MODEL_FAST / MODEL_STRONG).
    llm_base_url: str = ""
    # Send thinking={"type": "disabled"}. Reasoning models (e.g. DeepSeek) otherwise spend the
    # whole max_tokens budget on hidden reasoning and return empty text. Off by default.
    llm_disable_thinking: bool = False
    model_fast: str = "claude-haiku-5-5"
    model_strong: str = "claude-sonnet-5-5"

    price_in_per_mtok: float = 3.0
    price_out_per_mtok: float = 15.0
    run_max_cost_usd: float = 0.50
    run_max_tokens: int = 200_000

    # Recommendation pipeline knobs
    match_candidates: int = 40  # jobs sent to the LLM matcher after the cheap prefilter
    match_concurrency: int = 5
    per_company_cap: int = 5  # keeps one huge board (e.g. 700 jobs) from crowding out the rest
    startup_max_employees: int = 200
    mid_max_employees: int = 5000

    # Outreach (Researcher / Writer / Critic)
    research_max_steps: int = 4  # hard cap on the researcher's tool-use loop
    research_cache_ttl_hours: int = 24
    fetch_timeout_s: float = 10.0
    critic_threshold: int = 75  # overall score needed to pass
    critic_max_retries: int = 3  # rewrites after the first draft (so up to 4 drafts total)

    # Orchestrator hard caps
    run_max_steps: int = 30  # total graph steps per run (also bounds LangGraph's recursion)
    style_memory_notes: int = 5  # past feedback notes given to the Writer
    style_memory_examples: int = 2  # past approved drafts given to the Writer as tone examples

    llm_timeout_s: float = 60.0
    llm_max_retries: int = 3
    trace_dir: Path = Path("traces")

    db_path: Path = Path("data/nextrole.db")
    upload_dir: Path = Path("data/uploads")
    # AES-256-GCM keyring for field-level encryption of personal data: "id:key,id:key", FIRST entry
    # encrypts, all entries decrypt. Generate with `python -m nextrole.security genkey`. Never commit it.
    encryption_keys: str = ""
    # Legacy Fernet key from the first release. Still read (and used to derive a decrypt key) so old
    # data keeps working until `python -m nextrole.security encrypt-existing` has upgraded it.
    # Fernet key for encrypting stored resumes (legacy). Generate:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    resume_encryption_key: str = ""
    session_ttl_hours: int = 24 * 7
    cookie_secure: bool = False  # set True behind HTTPS
    # "production" forces Secure cookies and HSTS regardless of cookie_secure.
    env: str = "development"
    # CSRF: double-submit token + Origin check on every state-changing request (see security/web.py).
    csrf_enabled: bool = True
    # Browser origins allowed to call the API (the Next.js app, which proxies /api/*).
    allowed_origins: str = "http://127.0.0.1:3100,http://localhost:3100"
    rate_limit_enabled: bool = True
    # How many reverse proxies sit in front of the API and append to X-Forwarded-For. 0 = trust
    # nothing (use the socket address). Set 1 behind the Next.js proxy / a load balancer; setting
    # it when the API is directly reachable lets clients spoof their IP.
    trusted_proxy_hops: int = 0
    login_max_failures: int = 5  # consecutive failures before the account locks
    login_lockout_minutes: int = 15
    # Comma-separated emails that get the admin role at startup. The ONLY way to become an admin:
    # there is no API for granting it.
    admin_emails: str = ""
    max_upload_mb: int = 5


@lru_cache
def get_settings() -> Settings:
    return Settings()
