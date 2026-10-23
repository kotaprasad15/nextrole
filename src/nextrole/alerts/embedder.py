"""Text embeddings for the semantic role matcher.

`HashingEmbedder` is the default and needs nothing installed: word and character-trigram features
hashed into a fixed-size vector (the "hashing trick"), L2-normalised. It measures how much two short
texts share in wording ("Forward Deployed Engineer" vs "Forward Deployed Software Engineer" is
close, "Customer Solutions Engineer" is somewhere in the middle), which is exactly the band the
LLM verification step is there to judge. It is deterministic, instant and free, which also keeps the
tests honest.

`FastEmbedEmbedder` (optional, `ALERT_EMBEDDER=fastembed`, needs `uv add fastembed`) uses a real
sentence-embedding model for genuine semantic similarity. It is not a project dependency because it
downloads a model of ~100 MB; if it is requested but missing we log a warning and fall back to
hashing, so alerts keep working either way. Thresholds in config are tuned per embedder family.
"""
import hashlib
import logging
import math
import re
import struct
from typing import Protocol

from nextrole.roles.taxonomy import normalize

log = logging.getLogger(__name__)
DIM = 512
_WORD = re.compile(r"[a-z0-9+#]+")


class Embedder(Protocol):
    name: str

    def embed(self, texts: list[str]) -> list[list[float]]: ...


def cosine(a: list[float], b: list[float]) -> float:
    """Both vectors are L2-normalised, so the dot product is the cosine."""
    return sum(x * y for x, y in zip(a, b, strict=True))


class HashingEmbedder:
    name = "hash-512-v1"

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]

    @staticmethod
    def _one(text: str) -> list[float]:
        vec = [0.0] * DIM
        for word in _WORD.findall(normalize(text) or text.lower()):
            feats = [(word, 2.0)] + [(g, 1.0) for g in _trigrams(word)]
            for feat, weight in feats:
                h = int.from_bytes(hashlib.blake2b(feat.encode(), digest_size=8).digest(), "big")
                vec[h % DIM] += weight if (h >> 40) & 1 else -weight
        norm = math.sqrt(sum(v * v for v in vec))
        return [v / norm for v in vec] if norm else vec


def _trigrams(word: str) -> list[str]:
    padded = f"^{word}$"
    return [padded[i:i + 3] for i in range(max(1, len(padded) - 2))]


class FastEmbedEmbedder:
    name = "fastembed-bge-small-en-v1.5"

    def __init__(self) -> None:
        from fastembed import TextEmbedding  # optional dependency: import lazily

        self._model = TextEmbedding("BAAI/bge-small-en-v1.5")

    def embed(self, texts: list[str]) -> list[list[float]]:
        out = []
        for v in self._model.embed(texts):
            vec = [float(x) for x in v]
            norm = math.sqrt(sum(x * x for x in vec)) or 1.0
            out.append([x / norm for x in vec])
        return out


def get_embedder(kind: str = "hash") -> Embedder:
    if kind == "fastembed":
        try:
            return FastEmbedEmbedder()
        except Exception as exc:  # noqa: BLE001 - missing package, no network for the model download...
            log.warning("fastembed unavailable (%r); using the built-in hashing embedder", exc)
    return HashingEmbedder()


# ---- storage of vectors (job_embeddings.vec) ----
def pack(vec: list[float]) -> bytes:
    return struct.pack(f"<{len(vec)}f", *vec)


def unpack(blob: bytes) -> list[float]:
    return list(struct.unpack(f"<{len(blob) // 4}f", blob))
