from __future__ import annotations

import datetime as dt
import threading
from collections import defaultdict
from typing import Dict, Optional

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import settings as settings_mod
from .analytics import Portfolio, PortfolioInput, TxIn, meta_from_row
from .market_data import BASE_CURRENCY, fx_symbol, normalize_currency
from .models import DividendEvent, Price, Security, SplitEvent, Transaction

_cache: Dict[str, object] = {"key": None, "portfolio": None}
_cache_lock = threading.Lock()


def _load_series(db: Session, model, col: str, symbols) -> Dict[str, pd.Series]:
    if not symbols:
        return {}
    data = defaultdict(dict)
    for sym, d, v in db.execute(select(model.symbol, model.date, getattr(model, col)).where(model.symbol.in_(symbols))):
        data[sym][pd.Timestamp(d)] = v
    return {s: pd.Series(v, dtype=float).sort_index() for s, v in data.items()}


def build_portfolio(db: Session) -> Portfolio:
    cfg = settings_mod.get_settings(db)
    txs = [TxIn(id=t.id, date=t.date, type=t.type, symbol=t.symbol, quantity=t.quantity, price=t.price,
                fees=t.fees or 0.0, currency=t.currency) for t in db.scalars(select(Transaction))]
    symbols = {t.symbol for t in txs}
    bench = cfg["benchmark"]
    sec_symbols = symbols | ({bench} if bench else set())
    securities = {s.symbol: meta_from_row(s) for s in db.scalars(select(Security).where(Security.symbol.in_(sec_symbols)))}
    currencies = {normalize_currency(m.currency)[0] for m in securities.values()}
    currencies |= {normalize_currency(t.currency)[0] for t in txs}
    fx_syms = {fx_symbol(c) for c in currencies if c != BASE_CURRENCY}
    data = PortfolioInput(
        transactions=txs,
        securities=securities,
        prices=_load_series(db, Price, "close", sec_symbols | fx_syms),
        dividends=_load_series(db, DividendEvent, "amount", symbols),
        splits=_load_series(db, SplitEvent, "ratio", symbols),
        benchmark=bench,
        dividend_tax_rate=cfg["dividend_tax_rate"],
    )
    return Portfolio(data)


def get_portfolio(db: Session) -> Portfolio:
    key = (settings_mod.data_version(), dt.date.today())
    with _cache_lock:
        if _cache["key"] == key and _cache["portfolio"] is not None:
            return _cache["portfolio"]  # type: ignore[return-value]
    p = build_portfolio(db)
    with _cache_lock:
        _cache["key"], _cache["portfolio"] = key, p
    return p


def security_dict(sec: Optional[Security]) -> Optional[dict]:
    if sec is None:
        return None
    m = meta_from_row(sec)
    return {"symbol": m.symbol, "name": m.name, "currency": m.currency, "quote_type": m.quote_type,
            "sector": m.sector, "industry": m.industry, "country": m.country, "exchange": m.exchange,
            "sector_weights": m.sector_weights, "info": m.info}
