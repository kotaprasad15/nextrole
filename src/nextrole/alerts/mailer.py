"""Outgoing email for alerts: plain text, only ever to the account owner, always with an unsubscribe.

`SmtpMailer` uses the standard library (`smtplib`, STARTTLS) configured through `SMTP_*` settings; with
no SMTP host configured the app uses `NullMailer` and alerts stay in-app (the Settings UI says so).
Every message carries both a visible unsubscribe link and the one-click `List-Unsubscribe` headers
mail clients understand (RFC 8058). Only alert text we generated is included: the job title,
company, the one-line reason, and the apply link copied from the source record.
"""
import smtplib
import ssl
from email.message import EmailMessage
from typing import Protocol

from nextrole.config import Settings


class Mailer(Protocol):
    available: bool

    def send(self, *, to: str, subject: str, text: str, headers: dict[str, str]) -> None: ...


class NullMailer:
    available = False

    def send(self, *, to: str, subject: str, text: str, headers: dict[str, str]) -> None:
        raise RuntimeError("email is not configured")


class SmtpMailer:
    available = True

    def __init__(self, settings: Settings) -> None:
        self.s = settings

    def send(self, *, to: str, subject: str, text: str, headers: dict[str, str]) -> None:
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self.s.smtp_from or self.s.smtp_user, to, subject
        for k, v in headers.items():
            msg[k] = v
        msg.set_content(text)
        with smtplib.SMTP(self.s.smtp_host, self.s.smtp_port, timeout=20) as smtp:
            if self.s.smtp_starttls:
                smtp.starttls(context=ssl.create_default_context())
            if self.s.smtp_user:
                smtp.login(self.s.smtp_user, self.s.smtp_password)
            smtp.send_message(msg)


def get_mailer(settings: Settings) -> Mailer:
    return SmtpMailer(settings) if settings.smtp_host else NullMailer()


def build_digest(alerts: list[dict], *, unsubscribe_page: str, unsubscribe_post: str) -> tuple[str, str, dict[str, str]]:
    """(subject, body, headers) for a batch of alerts."""
    n = len(alerts)
    subject = f"NextRole: {n} new role{'s' if n != 1 else ''} at companies you watch"
    lines = [f"{n} new role{'s' if n != 1 else ''} matched what you are looking for:", ""]
    for a in alerts:
        lines += [f"- {a['title']} at {a['company']}" + (f" ({a['location']})" if a.get("location") else ""),
                  f"  Why: {a['why']}"]
        if a.get("apply_url"):
            lines.append(f"  Apply: {a['apply_url']}")
        lines.append("")
    lines += ["Open NextRole to see them all and write outreach.", "",
              f"You get this because you turned on email alerts. Unsubscribe: {unsubscribe_page}"]
    headers = {"List-Unsubscribe": f"<{unsubscribe_post}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}
    return subject, "\n".join(lines), headers
