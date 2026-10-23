"""Run one alert pass from the command line (cron, a scheduled task, or by hand):

    uv run python -m nextrole.alerts_job

Needs the same `.env` as the API (database, keys, optional SMTP). Prints the aggregate counters.
"""
import asyncio
import json

from nextrole.alerts.embedder import get_embedder
from nextrole.alerts.mailer import get_mailer
from nextrole.alerts.runner import run_alerts
from nextrole.config import get_settings
from nextrole.db.connection import connect
from nextrole.llm.budget import Budget
from nextrole.llm.client import LLMClient
from nextrole.metrics import make_usage_sink
from nextrole.security import crypto
from nextrole.tracing.tracer import Tracer


def main() -> int:
    settings = get_settings()
    keyring = crypto.Keyring.parse(settings.encryption_keys, settings.resume_encryption_key)
    if keyring is None:
        print("ENCRYPTION_KEYS is not set.")
        return 2
    crypto.configure(keyring)
    conn = connect(settings.db_path)
    stats = asyncio.run(run_alerts(
        conn=conn, settings=settings,
        llm_factory=lambda: LLMClient(settings, Budget.from_settings(settings), Tracer(settings.trace_dir), usage_sink=make_usage_sink(conn)),
        mailer=get_mailer(settings), embedder=get_embedder(settings.alert_embedder)))
    print(json.dumps(stats))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
