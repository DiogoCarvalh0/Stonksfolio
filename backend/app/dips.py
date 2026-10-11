"""Technical "dip" metrics: how far a price trades from its moving averages / recent high."""
from __future__ import annotations

from typing import Optional, Sequence


def _pct(a: float, b: float) -> Optional[float]:
    return round((a / b - 1) * 100, 2) if b else None


def sma(closes: Sequence[float], n: int) -> Optional[float]:
    return sum(closes[-n:]) / n if len(closes) >= n else None


def rsi(closes: Sequence[float], n: int = 14) -> Optional[float]:
    """Wilder's RSI over the full series (needs at least n+1 closes)."""
    if len(closes) <= n:
        return None
    deltas = [b - a for a, b in zip(closes, closes[1:])]
    gain = sum(max(d, 0) for d in deltas[:n]) / n
    loss = sum(max(-d, 0) for d in deltas[:n]) / n
    for d in deltas[n:]:
        gain = (gain * (n - 1) + max(d, 0)) / n
        loss = (loss * (n - 1) + max(-d, 0)) / n
    if loss == 0:
        return 100.0
    return round(100 - 100 / (1 + gain / loss), 2)


def dip_metrics(closes: Sequence[float]) -> dict:
    """Metrics from daily closes (oldest first). Missing history yields None for that metric."""
    if not closes:
        return {"price": None, "sma50": None, "sma200": None, "vs_sma50": None, "vs_sma200": None,
                "high_52w": None, "from_high": None, "rsi14": None}
    last = closes[-1]
    s50, s200 = sma(closes, 50), sma(closes, 200)
    high = max(closes[-252:])
    return {
        "price": last,
        "sma50": s50,
        "sma200": s200,
        "vs_sma50": _pct(last, s50) if s50 else None,
        "vs_sma200": _pct(last, s200) if s200 else None,
        "high_52w": high,
        "from_high": _pct(last, high),
        "rsi14": rsi(closes),
    }
