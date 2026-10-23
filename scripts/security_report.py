"""Run the security and adversarial tests and print (or write into README.md) the pass rates.

    uv run python scripts/security_report.py            # print the table
    uv run python scripts/security_report.py --readme   # also rewrite the marked section of README.md

What the numbers mean (they are also stated next to the table): every test uses MOCKED models, some of them
deliberately HIJACKED so they obey injected text. A pass shows the system around the model contains the
damage (data blocks, schema validation, link stripping, output guard, rules, human approval). It does NOT
measure how often a real model is fooled by an injection; that needs live calls and is out of scope here.
"""
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
START, END = "<!-- security-report:start -->", "<!-- security-report:end -->"

CATEGORIES = {
    "test_adversarial_corpus": "Prompt injection through resumes, postings, tool results and interview posts (hijacked models)",
    "test_prompt_injection": "Prompt-injection defences: data blocks, scanner, output guard, link stripping",
    "test_uploads": "Malicious PDF / DOCX uploads (scripts, hidden text, bombs, spoofed types, isolation)",
    "test_ssrf": "SSRF (private ranges, IPv6 tricks, redirects, DNS rebinding, size caps)",
    "test_access_and_leaks": "Access control on every route, CSRF, admin role, information leaks, cookie flags",
    "test_privacy": "Encryption at rest, data export, account deletion, trace redaction",
    "test_repo_secrets": "Secrets committed to the repository",
    "test_security_web": "Login lockout, rate limits, CSRF, security headers, admin role",
    "test_security_crypto": "Field encryption (AES-256-GCM), key rotation, migrations",
    "test_interviews": "Interview posts: XSS sanitising, personal data, moderation, reports",
    "test_admin_metrics": "Admin dashboard: totals only (no per-user data), traces, budgets",
    "test_alerts": "Alerts: dedup, caps, email opt-in, unsubscribe tokens",
}
PATHS = ["tests/security", "tests/unit/test_security_web.py", "tests/unit/test_security_crypto.py", "tests/unit/test_interviews.py",
         "tests/unit/test_admin_metrics.py", "tests/unit/test_alerts.py"]


def run() -> dict[str, dict[str, int]]:
    with tempfile.TemporaryDirectory() as tmp:
        xml_path = Path(tmp) / "report.xml"
        subprocess.run([sys.executable, "-m", "pytest", *PATHS, "-q", "-p", "no:cacheprovider", f"--junitxml={xml_path}"],
                       cwd=ROOT, check=False, capture_output=True)
        tree = ET.parse(xml_path)
    stats: dict[str, dict[str, int]] = defaultdict(lambda: {"total": 0, "passed": 0, "failed": 0, "skipped": 0})
    for case in tree.iter("testcase"):
        module = case.get("classname", "").split(".")[-1]
        if module not in CATEGORIES:
            continue
        s = stats[module]
        s["total"] += 1
        if case.find("failure") is not None or case.find("error") is not None:
            s["failed"] += 1
        elif case.find("skipped") is not None:
            s["skipped"] += 1
        else:
            s["passed"] += 1
    return stats


def table(stats: dict[str, dict[str, int]]) -> str:
    rows = ["| Area | Tests | Passed | Failed | Pass rate |", "|---|---:|---:|---:|---:|"]
    total = passed = 0
    for module, label in CATEGORIES.items():
        s = stats.get(module)
        if not s:
            continue
        ran = s["total"] - s["skipped"]
        rate = f"{100 * s['passed'] / ran:.1f}%" if ran else "n/a"
        rows.append(f"| {label} | {s['total']} | {s['passed']} | {s['failed']} | {rate} |")
        total, passed = total + ran, passed + s["passed"]
    rows.append(f"| **All** | **{total}** | **{passed}** | **{total - passed}** | **{100 * passed / total:.1f}%** |" if total else "| **All** | 0 | 0 | 0 | n/a |")
    return "\n".join(rows)


def corpus_note() -> str:
    sys.path.insert(0, str(ROOT))
    from tests.security.payloads import BENIGN, INJECTIONS

    return (f"The injection corpus has {len(INJECTIONS)} payloads (direct overrides, role changes, chat-template tokens, delimiter forgery, "
            f"prompt extraction, link and score manipulation, tool requests), each delivered through up to four channels, plus "
            f"{len(BENIGN)} harmless look-alikes that must NOT be flagged.")


def main() -> int:
    stats = run()
    block = (f"{START}\n{table(stats)}\n\n{corpus_note()}\n\n"
             "How to read this: the models in these tests are mocked, and for the injection tests they are *hijacked* on purpose "
             "(they obey whatever the injected text says). A pass means the system around the model contained the damage: untrusted text "
             "stays inside data blocks, outputs are schema-validated and link-stripped, rules and an output guard run independently of the "
             "model, and a human approves anything public. It does **not** measure how often a real model is fooled; that needs live "
             "calls. Regenerate with `uv run python scripts/security_report.py --readme`.\n"
             f"{END}")
    print(block)
    if "--readme" in sys.argv:
        readme = ROOT / "README.md"
        text = readme.read_text(encoding="utf-8")
        if START in text and END in text:
            head, rest = text.split(START, 1)
            _, tail = rest.split(END, 1)
            readme.write_text(head + block + tail, encoding="utf-8")
        else:
            print("README.md has no security-report markers", file=sys.stderr)
            return 1
    failed = sum(s["failed"] for s in stats.values())
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
