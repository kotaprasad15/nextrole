"""Pure, dependency-free statistics for the evaluation.

Design decision: n is small (30 paired runs), so every headline number carries a bootstrap
95% confidence interval and paired comparisons use paired bootstrap. A difference whose
interval spans zero is reported as inconclusive, not as a win. A fixed seed keeps the report
reproducible from the saved raw results.
"""
import math
import random
from collections import Counter
from collections.abc import Sequence


def mean(xs: Sequence[float]) -> float:
    return sum(xs) / len(xs) if xs else float("nan")


def percentile(xs: Sequence[float], q: float) -> float:
    """Linear-interpolated percentile, q in [0, 100]."""
    if not xs:
        return float("nan")
    s = sorted(xs)
    pos = (len(s) - 1) * q / 100
    lo, hi = math.floor(pos), math.ceil(pos)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def bootstrap_ci(
    xs: Sequence[float], n_boot: int = 4000, alpha: float = 0.05, seed: int = 0
) -> tuple[float, float]:
    """Percentile bootstrap CI for the mean."""
    if len(xs) < 2:
        return (float("nan"), float("nan"))
    rng = random.Random(seed)
    means = sorted(mean([rng.choice(xs) for _ in xs]) for _ in range(n_boot))
    return (means[int(n_boot * alpha / 2)], means[int(n_boot * (1 - alpha / 2)) - 1])


def paired_diff(
    a: Sequence[float], b: Sequence[float], **kw
) -> tuple[float, float, float]:
    """(mean(a-b), ci_low, ci_high) over paired observations."""
    if len(a) != len(b):
        raise ValueError("paired samples must have equal length")
    diffs = [x - y for x, y in zip(a, b, strict=True)]
    lo, hi = bootstrap_ci(diffs, **kw)
    return mean(diffs), lo, hi


def verdict(lo: float, hi: float) -> str:
    """Plain-language reading of a difference interval (a minus b)."""
    if math.isnan(lo):
        return "n/a"
    if lo > 0:
        return "a better"
    if hi < 0:
        return "b better"
    return "inconclusive"


def win_tie_loss(outcomes: Sequence[str]) -> tuple[int, int, int]:
    """Counts of 'win' / 'tie' / 'loss' strings."""
    c = Counter(outcomes)
    return c["win"], c["tie"], c["loss"]


def wilson_ci(successes: int, n: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval for a proportion (well behaved at small n)."""
    if n == 0:
        return (float("nan"), float("nan"))
    p = successes / n
    denom = 1 + z * z / n
    centre = (p + z * z / (2 * n)) / denom
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / denom
    return (centre - half, centre + half)


def accuracy(labels: Sequence[str], preds: Sequence[str]) -> float:
    return mean([float(a == b) for a, b in zip(labels, preds, strict=True)])


def confusion(
    labels: Sequence[str], preds: Sequence[str], classes: Sequence[str]
) -> dict[str, dict[str, int]]:
    """matrix[true][predicted] -> count."""
    m = {t: {p: 0 for p in classes} for t in classes}
    for t, p in zip(labels, preds, strict=True):
        m[t][p] += 1
    return m


def per_class_prf(
    labels: Sequence[str], preds: Sequence[str], classes: Sequence[str]
) -> dict[str, dict[str, float]]:
    out = {}
    for c in classes:
        tp = sum(1 for t, p in zip(labels, preds, strict=True) if t == c and p == c)
        fp = sum(1 for t, p in zip(labels, preds, strict=True) if t != c and p == c)
        fn = sum(1 for t, p in zip(labels, preds, strict=True) if t == c and p != c)
        prec = tp / (tp + fp) if tp + fp else float("nan")
        rec = tp / (tp + fn) if tp + fn else float("nan")
        f1 = 2 * prec * rec / (prec + rec) if tp and prec + rec else 0.0
        out[c] = {"precision": prec, "recall": rec, "f1": f1, "support": tp + fn}
    return out


def precision_at_k(relevance: Sequence[int], k: int = 10) -> float:
    """Fraction of the first k results that are relevant (missing results count as misses)."""
    return sum(relevance[:k]) / k
