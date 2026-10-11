"""Share-count validation: a SELL may never exceed the shares held on its date.

Quantities are compared on the current split basis (qty * product of later split ratios),
the same convention the analytics engine uses.
"""
from __future__ import annotations

import datetime as dt
from dataclasses import dataclass
from typing import Dict, Iterable, List, Sequence, Tuple

EPS = 1e-6
Splits = Dict[str, List[Tuple[dt.date, float]]]


@dataclass
class Tx:
    id: float
    date: dt.date
    type: str
    symbol: str
    quantity: float


@dataclass
class SellError:
    tx_id: float
    symbol: str
    date: dt.date
    quantity: float
    held: float

    def message(self) -> str:
        return (f"Cannot sell {_n(self.quantity)} shares of {self.symbol} on {self.date.isoformat()}: "
                f"only {_n(self.held)} held on that date.")


def _n(v: float) -> str:
    return f"{round(v, 6):g}"


def split_factor(splits: Splits, symbol: str, date: dt.date) -> float:
    f = 1.0
    for d, r in splits.get(symbol, ()):
        if d > date and r:
            f *= r
    return f


def _ordered(txs: Iterable[Tx]) -> List[Tx]:
    # Same-day buys are applied before sells, so buying and selling on one day is allowed.
    return sorted((t for t in txs if t.type in ("BUY", "SELL")), key=lambda t: (t.date, t.type != "BUY", t.id))


def sell_errors(txs: Sequence[Tx], splits: Splits) -> List[SellError]:
    held: Dict[str, float] = {}
    out = []
    for t in _ordered(txs):
        f = split_factor(splits, t.symbol, t.date)
        q = t.quantity * f
        h = held.get(t.symbol, 0.0)
        if t.type == "BUY":
            held[t.symbol] = h + q
        elif q > h + EPS:
            out.append(SellError(t.id, t.symbol, t.date, t.quantity, max(h, 0.0) / f))
            held[t.symbol] = 0.0
        else:
            held[t.symbol] = h - q
    return out


def max_sellable(txs: Sequence[Tx], splits: Splits, symbol: str, date: dt.date) -> float:
    """Largest quantity (in shares as of `date`) that can be sold on `date` without breaking later sells."""
    held = 0.0
    end_of_day: Dict[dt.date, float] = {}
    for t in _ordered(x for x in txs if x.symbol == symbol):
        q = t.quantity * split_factor(splits, symbol, t.date)
        held = held + q if t.type == "BUY" else max(held - q, 0.0)
        end_of_day[t.date] = held
    before = [v for d, v in end_of_day.items() if d <= date]
    later = [v for d, v in end_of_day.items() if d > date]
    low = min([before[-1] if before else 0.0, *later])
    return max(low, 0.0) / split_factor(splits, symbol, date)
