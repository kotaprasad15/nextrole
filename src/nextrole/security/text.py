"""Text sanitisers for model output and user-written content.

- `strip_links`: model output may never carry a URL or email address we did not put there, so
  fields that come from a model are scrubbed of them by the schema itself.
- `plain_text`: user-written text (interview experiences, notes) is stored and rendered as PLAIN
  text only. Tags are removed, entities decoded once, control/invisible characters stripped, and
  length capped. React escapes on output; this keeps stored data clean for the LLM moderation
  prompt, exports and any future non-React consumer.
"""
import html
import re

_URL = re.compile(r"(?i)\b(?:https?://|ftp://|www\.)[^\s<>\"')]+")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_TAG = re.compile(r"<[^>]*>")
_SCRIPTISH = re.compile(r"(?is)<(script|style|iframe|object|embed)\b.*?(</\1\s*>|$)")
_HIDDEN = [(0x00, 0x08), (0x0B, 0x0C), (0x0E, 0x1F), (0x7F, 0x9F), (0x200B, 0x200F), (0x202A, 0x202E),
           (0x2060, 0x2064), (0x2066, 0x2069), (0xFEFF, 0xFEFF)]
_CONTROL = re.compile("[" + "".join(f"{chr(a)}-{chr(b)}" for a, b in _HIDDEN) + "]")


def strip_links(text: str) -> str:
    return _EMAIL.sub("", _URL.sub("", text)).strip()


def plain_text(text: str, max_len: int = 5000) -> str:
    text = _SCRIPTISH.sub(" ", text)
    text = _TAG.sub("", html.unescape(_TAG.sub("", text)))  # tags, then entities, then tags revealed by decoding
    text = _CONTROL.sub("", text).replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:max_len]
