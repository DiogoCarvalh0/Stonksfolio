from __future__ import annotations

import csv
import datetime as dt
import io
import json
import logging
import math
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

import pandas as pd
import yfinance as yf
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import market_data as md
from . import settings as settings_mod
from .db import SessionLocal, get_session, init_db
from . import positions as pos
from .models import TX_TYPES, ApiCache, DividendEvent, Price, Security, SplitEvent, Transaction, WatchlistItem
from .service import get_portfolio, security_dict

logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))
log = logging.getLogger("stonksfolio")

scheduler = BackgroundScheduler()


# ---------------------------------------------------------------- lifecycle

def _background_refresh(force_info: bool = False):
    def run():
        db = SessionLocal()
        try:
            md.refresh_all(db, force_info=force_info)
        except Exception as exc:  # pragma: no cover
            log.exception("refresh failed")
            md.refresh_state["last_error"] = str(exc)
        finally:
            db.close()

    threading.Thread(target=run, daemon=True).start()


@asynccontextmanager
async def lifespan(_app):
    init_db()
    if os.environ.get("STONKSFOLIO_DISABLE_SCHEDULER") != "1":
        hours = os.environ.get("STONKSFOLIO_REFRESH_HOURS", "7,23")
        scheduler.add_job(_background_refresh, "cron", hour=hours, minute=0, id="refresh", replace_existing=True)
        scheduler.start()
        _background_refresh()
    yield
    if scheduler.running:
        scheduler.shutdown(wait=False)


app = FastAPI(title="Stonksfolio", version="1.0.0", lifespan=lifespan)


# ---------------------------------------------------------------- schemas

class TxBody(BaseModel):
    date: dt.date
    type: str
    symbol: str = Field(min_length=1, max_length=32)
    quantity: float = Field(gt=0)
    price: float = Field(ge=0)
    fees: float = Field(default=0, ge=0)
    currency: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("type")
    @classmethod
    def _type(cls, v):
        v = v.upper().strip()
        if v not in TX_TYPES:
            raise ValueError(f"type must be one of {', '.join(TX_TYPES)}")
        return v

    @field_validator("symbol")
    @classmethod
    def _symbol(cls, v):
        return v.upper().strip()

    @field_validator("date")
    @classmethod
    def _date(cls, v):
        if v > dt.date.today():
            raise ValueError("date cannot be in the future")
        return v


class SettingsBody(BaseModel):
    benchmark: Optional[str] = None
    dividend_tax_rate: Optional[float] = Field(default=None, ge=0, le=100)


def tx_dict(t: Transaction, names: dict) -> dict:
    return {"id": t.id, "date": t.date.isoformat(), "type": t.type, "symbol": t.symbol, "name": names.get(t.symbol),
            "quantity": t.quantity, "price": t.price, "fees": t.fees, "currency": t.currency, "notes": t.notes,
            "total": round(t.quantity * t.price + (t.fees if t.type == "BUY" else -t.fees), 4)}


def _names(db: Session) -> dict:
    return dict(db.execute(select(Security.symbol, Security.name)).all())


def _prepare(db: Session, body: TxBody) -> str:
    try:
        sec = md.prepare_symbol(db, body.symbol, body.date, body.currency)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(400, str(exc))
    except Exception as exc:
        db.rollback()
        raise HTTPException(502, f"Market data error for {body.symbol}: {exc}")
    return body.currency or sec.currency or md.BASE_CURRENCY


def _ptx(t, tx_id: float) -> pos.Tx:
    return pos.Tx(tx_id, t.date, t.type, t.symbol, t.quantity)


def _ledger(db: Session, symbols, exclude_id: Optional[int] = None) -> List[pos.Tx]:
    q = select(Transaction).where(Transaction.symbol.in_(list(symbols)))
    return [_ptx(t, t.id) for t in db.scalars(q) if t.id != exclude_id]


def _splits(db: Session, symbols) -> pos.Splits:
    out: pos.Splits = {}
    for s, d, r in db.execute(select(SplitEvent.symbol, SplitEvent.date, SplitEvent.ratio)
                              .where(SplitEvent.symbol.in_(list(symbols)))):
        out.setdefault(s, []).append((d, r))
    return out


def _check_sells(db: Session, before: List[pos.Tx], after: List[pos.Tx], changed: set = frozenset(), prefix: str = "") -> None:
    """Reject if the change introduces an oversell (pre-existing ones only block the transactions involved)."""
    splits = _splits(db, {t.symbol for t in before + after})
    old = {e.tx_id for e in pos.sell_errors(before, splits)}
    new = [e for e in pos.sell_errors(after, splits) if e.tx_id in changed or e.tx_id not in old]
    if new:
        db.rollback()
        raise HTTPException(400, prefix + " ".join(e.message() for e in new[:5]))


# ---------------------------------------------------------------- analytics

@app.get("/api/summary")
def summary(db: Session = Depends(get_session)):
    return get_portfolio(db).summary()


@app.get("/api/performance")
def performance(benchmarks: Optional[str] = None, db: Session = Depends(get_session)):
    """Portfolio series; `benchmarks` (comma-separated symbols) adds EUR price indices aligned to the series."""
    p = get_portfolio(db)
    out = p.performance()
    if benchmarks is None:
        return out
    symbols = list(dict.fromkeys(s.strip().upper() for s in benchmarks.split(",") if s.strip()))[:6]
    if p.txs:
        start = p.dates[0].date()
        stale_before = dt.datetime.utcnow() - dt.timedelta(hours=12)
        for sym in symbols:
            sec = db.get(Security, sym)
            if (sec is None or not sec.history_start or sec.history_start > start - md.HISTORY_START_PADDING
                    or not sec.history_updated_at or sec.history_updated_at < stale_before):
                try:
                    md.prepare_symbol(db, sym, start)
                except Exception as exc:
                    db.rollback()
                    log.warning("benchmark %s unavailable: %s", sym, exc)
    out["benchmarks"] = []
    for sym in symbols:
        sec = db.get(Security, sym)
        idx = None
        if sec is not None and p.txs:
            closes = pd.Series({pd.Timestamp(d): c for d, c in db.execute(
                select(Price.date, Price.close).where(Price.symbol == sym))}, dtype=float)
            cur = md.normalize_currency(sec.currency)[0]
            fx_sym = md.fx_symbol(cur)
            if cur != md.BASE_CURRENCY and fx_sym not in p.data.prices:
                p.data.prices[fx_sym] = pd.Series({pd.Timestamp(d): c for d, c in db.execute(
                    select(Price.date, Price.close).where(Price.symbol == fx_sym))}, dtype=float)
            idx = p.price_index(closes, sec.currency)
        out["benchmarks"].append({
            "symbol": sym,
            "name": sec.name if sec else sym,
            "index": [None if v is None or v != v else round(float(v), 6) for v in idx] if idx is not None else None,
        })
    return out


@app.get("/api/holdings")
def holdings(include_closed: bool = False, db: Session = Depends(get_session)):
    return get_portfolio(db).holdings(include_closed=include_closed)


@app.get("/api/dips")
def dips(source: str = Query("holdings", pattern="^(holdings|watchlist|all)$"), db: Session = Depends(get_session)):
    from .dips import dip_metrics

    symbols: dict = {}
    if source in ("holdings", "all"):
        try:
            for h in get_portfolio(db).holdings():
                symbols[h["symbol"]] = {"name": h["name"], "currency": h["currency"], "held": True}
        except Exception:  # empty portfolio
            pass
    if source in ("watchlist", "all"):
        for (s,) in db.execute(select(WatchlistItem.symbol)):
            symbols.setdefault(s, {"name": None, "currency": None, "held": False})
    if not symbols:
        return []
    secs = {s.symbol: s for s in db.scalars(select(Security).where(Security.symbol.in_(list(symbols))))}
    since = dt.date.today() - dt.timedelta(days=400)
    closes: dict = {s: [] for s in symbols}
    for s, c in db.execute(select(Price.symbol, Price.close).where(Price.symbol.in_(list(symbols)), Price.date >= since)
                           .order_by(Price.symbol, Price.date)):
        closes[s].append(c)
    out = []
    insider = _insider_summaries(list(symbols))
    for s, meta in symbols.items():
        sec = secs.get(s)
        out.append({"symbol": s, "name": meta["name"] or (sec.name if sec else s),
                    "currency": meta["currency"] or (sec.currency if sec else None),
                    "held": meta["held"], **dip_metrics(closes[s]), **insider[s]})
    return out


@app.get("/api/sentiment")
def sentiment():
    from . import sentiment as sentiment_mod

    try:
        return sentiment_mod.get()
    except Exception as exc:
        log.warning("fear & greed fetch failed: %s", exc)
        raise HTTPException(502, f"Could not load the CNN Fear & Greed index: {exc}")


@app.get("/api/allocation")
def allocation(db: Session = Depends(get_session)):
    return get_portfolio(db).allocation()


@app.get("/api/dividends")
def dividends(db: Session = Depends(get_session)):
    # Dividend growth needs ~6 full years of payouts; backfill held symbols once (same depth as stock pages).
    start = dt.date.today() - dt.timedelta(days=365 * 10)
    held = [s for (s,) in db.execute(select(Transaction.symbol).distinct())]
    extended = False
    for sym in held:
        sec = db.get(Security, sym)
        if sec is not None and sec.history_start and sec.history_start > start:
            try:
                md.update_history(db, sym, start)
                extended = True
            except Exception as exc:
                db.rollback()
                log.warning("dividend history backfill failed for %s: %s", sym, exc)
    if extended:
        settings_mod.bump_version()
    return get_portfolio(db).dividends()


# ---------------------------------------------------------------- transactions

@app.get("/api/transactions")
def list_transactions(symbol: Optional[str] = None, db: Session = Depends(get_session)):
    q = select(Transaction).order_by(Transaction.date.desc(), Transaction.id.desc())
    if symbol:
        q = q.where(Transaction.symbol == symbol.upper())
    names = _names(db)
    return [tx_dict(t, names) for t in db.scalars(q)]


@app.post("/api/transactions", status_code=201)
def create_transaction(body: TxBody, db: Session = Depends(get_session)):
    currency = _prepare(db, body)
    before = _ledger(db, {body.symbol})
    _check_sells(db, before, before + [_ptx(body, float("inf"))], {float("inf")})
    t = Transaction(**body.model_dump(exclude={"currency"}), currency=currency)
    db.add(t)
    db.commit()
    settings_mod.bump_version()
    return tx_dict(t, _names(db))


@app.put("/api/transactions/{tx_id}")
def update_transaction(tx_id: int, body: TxBody, db: Session = Depends(get_session)):
    t = db.get(Transaction, tx_id)
    if not t:
        raise HTTPException(404, "Transaction not found")
    currency = _prepare(db, body)
    before = _ledger(db, {t.symbol, body.symbol})
    _check_sells(db, before, _ledger(db, {t.symbol, body.symbol}, exclude_id=t.id) + [_ptx(body, t.id)], {t.id})
    for k, v in body.model_dump(exclude={"currency"}).items():
        setattr(t, k, v)
    t.currency = currency
    db.commit()
    settings_mod.bump_version()
    return tx_dict(t, _names(db))


@app.delete("/api/transactions/{tx_id}", status_code=204)
def delete_transaction(tx_id: int, db: Session = Depends(get_session)):
    t = db.get(Transaction, tx_id)
    if not t:
        raise HTTPException(404, "Transaction not found")
    _check_sells(db, _ledger(db, {t.symbol}), _ledger(db, {t.symbol}, exclude_id=t.id),
                 prefix="Deleting this transaction would leave a later sell uncovered. ")
    db.delete(t)
    db.commit()
    settings_mod.bump_version()


CSV_COLUMNS = ["date", "type", "symbol", "quantity", "price", "fees", "currency", "notes"]
DATE_FORMATS = ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%Y/%m/%d")


def _parse_date(s: str) -> dt.date:
    s = s.strip()[:10]
    for f in DATE_FORMATS:
        try:
            return dt.datetime.strptime(s, f).date()
        except ValueError:
            pass
    raise ValueError(f"invalid date '{s}'")


def _parse_num(s: Optional[str], default: Optional[float] = None) -> float:
    s = (s or "").strip().replace(" ", "")
    if not s:
        if default is None:
            raise ValueError("missing number")
        return default
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".") if s.rfind(",") > s.rfind(".") else s.replace(",", "")
    elif "," in s:
        s = s.replace(",", ".")
    return float(s)


CSV_REQUIRED = ("date", "type", "symbol", "quantity", "price")
CSV_ALIASES = {
    "date": ("date", "trade date", "transaction date", "datum", "data"),
    "type": ("type", "action", "side", "transaction type", "buy/sell"),
    "symbol": ("symbol", "ticker", "isin", "product", "security", "instrument"),
    "quantity": ("quantity", "qty", "shares", "units", "amount of shares", "aantal", "quantidade"),
    "price": ("price", "unit price", "price per share", "share price", "koers", "preço"),
    "fees": ("fees", "fee", "commission", "costs", "transaction costs", "kosten"),
    "currency": ("currency", "ccy", "valuta", "moeda"),
    "notes": ("notes", "note", "comment", "description", "memo"),
    "exchange": ("exchange", "market", "venue", "exchange code", "beurs", "bolsa", "mercado"),
}
IMPORT_FIELDS = CSV_COLUMNS + ["exchange"]


def _read_csv(text: str) -> tuple[List[str], List[List[str]]]:
    text = text.lstrip("\ufeff")
    lines = text.splitlines()
    if not lines:
        return [], []
    try:
        dialect = csv.Sniffer().sniff(lines[0], delimiters=",;\t")
    except Exception:
        dialect = csv.excel
    reader = csv.reader(io.StringIO(text), dialect=dialect)
    headers = [h.strip() for h in next(reader, [])]
    return headers, list(reader)


def guess_mapping(headers: List[str]) -> dict[str, int]:
    norm = [h.strip().lower() for h in headers]
    mapping: dict[str, int] = {}
    for field in IMPORT_FIELDS:
        for alias in CSV_ALIASES[field]:
            if alias in norm and norm.index(alias) not in mapping.values():
                mapping[field] = norm.index(alias)
                break
    return mapping


def parse_csv(text: str, mapping: Optional[dict[str, int]] = None) -> tuple[List[TxBody], List[str]]:
    headers, data = _read_csv(text)
    if not headers:
        return [], ["Empty file"]
    if mapping is None:
        mapping = guess_mapping(headers)
    mapping = {f: i for f, i in mapping.items() if f in IMPORT_FIELDS and i is not None}
    bad = [f for f, i in mapping.items() if not isinstance(i, int) or not 0 <= i < len(headers)]
    if bad:
        return [], [f"Invalid column for: {', '.join(bad)}"]
    missing = set(CSV_REQUIRED) - set(mapping)
    if missing:
        return [], [f"Missing columns: {', '.join(sorted(missing))}. Expected: {', '.join(CSV_COLUMNS)}"]
    rows, errors = [], []
    for n, raw in enumerate(data, start=2):
        if not any(v.strip() for v in raw):
            continue
        r = {f: (raw[i] if i < len(raw) else "") for f, i in mapping.items()}
        try:
            rows.append(TxBody(
                date=_parse_date(r["date"]), type=r["type"],
                symbol=md.symbol_for_exchange(r["symbol"], r.get("exchange")),
                quantity=abs(_parse_num(r["quantity"])), price=_parse_num(r["price"]),
                fees=abs(_parse_num(r.get("fees"), 0.0)),
                currency=(r.get("currency") or "").strip() or None, notes=(r.get("notes") or "").strip() or None,
            ))
        except Exception as exc:
            msg = exc.errors()[0]["msg"] if hasattr(exc, "errors") else str(exc)
            errors.append(f"Row {n}: {msg}")
    return rows, errors


def _read_upload(file: UploadFile) -> str:
    raw = file.file.read()
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        return raw.decode("latin-1")


@app.post("/api/transactions/import/preview")
def preview_import(file: UploadFile = File(...)):
    headers, data = _read_csv(_read_upload(file))
    if not headers:
        raise HTTPException(400, {"errors": ["Empty file"]})
    sample = [r for r in data if any(v.strip() for v in r)][:5]
    return {"headers": headers, "sample": sample, "mapping": guess_mapping(headers)}


@app.post("/api/transactions/import")
def import_transactions(file: UploadFile = File(...), mapping: Optional[str] = Form(None),
                        db: Session = Depends(get_session)):
    text = _read_upload(file)
    col_map = None
    if mapping:
        try:
            col_map = json.loads(mapping)
            assert isinstance(col_map, dict)
        except Exception:
            raise HTTPException(400, {"errors": ["Invalid column mapping"]})
    rows, errors = parse_csv(text, col_map)
    if errors:
        raise HTTPException(400, {"errors": errors})
    if not rows:
        raise HTTPException(400, {"errors": ["No transactions found"]})
    earliest = {}
    for r in rows:
        earliest[r.symbol] = min(earliest.get(r.symbol, r.date), r.date)
    currencies = {}
    for sym, start in earliest.items():
        try:
            sec = md.prepare_symbol(db, sym, start)
            currencies[sym] = sec.currency
        except Exception as exc:
            db.rollback()
            errors.append(f"{sym}: {exc}")
    for r in rows:
        if r.currency and md.normalize_currency(r.currency)[0] != md.BASE_CURRENCY:
            try:
                md.update_history(db, md.fx_symbol(md.normalize_currency(r.currency)[0]), earliest[r.symbol])
            except Exception as exc:
                db.rollback()
                errors.append(f"FX {r.currency}: {exc}")
    if errors:
        raise HTTPException(400, {"errors": sorted(set(errors))})
    before = _ledger(db, set(earliest))
    new_ids = {1e12 + i for i in range(len(rows))}
    try:
        _check_sells(db, before, before + [_ptx(r, 1e12 + i) for i, r in enumerate(rows)], new_ids)
    except HTTPException as exc:
        raise HTTPException(400, {"errors": [exc.detail]})
    for r in rows:
        db.add(Transaction(**r.model_dump(exclude={"currency"}), currency=r.currency or currencies[r.symbol]))
    db.commit()
    settings_mod.bump_version()
    return {"imported": len(rows)}


@app.get("/api/transactions/export")
def export_transactions(db: Session = Depends(get_session)):
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(CSV_COLUMNS)
    for t in db.scalars(select(Transaction).order_by(Transaction.date, Transaction.id)):
        w.writerow([t.date.isoformat(), t.type, t.symbol, t.quantity, t.price, t.fees, t.currency, t.notes or ""])
    buf.seek(0)
    return StreamingResponse(iter([buf.getvalue()]), media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=transactions.csv"})


# ---------------------------------------------------------------- research

@app.get("/api/search")
def search(q: str = Query(min_length=1)):
    return md.search(q)


@app.get("/api/stock/{symbol}/sellable")
def sellable(symbol: str, date: dt.date, exclude: Optional[int] = None, db: Session = Depends(get_session)):
    symbol = symbol.upper()
    q = pos.max_sellable(_ledger(db, {symbol}, exclude_id=exclude), _splits(db, {symbol}), symbol, date)
    return {"symbol": symbol, "date": date.isoformat(), "quantity": round(q, 6)}


@app.get("/api/stock/{symbol}/listings")
def stock_listings(symbol: str, db: Session = Depends(get_session)):
    """Other exchange listings of the same security (same ISIN)."""
    try:
        md.ensure_security(db, symbol)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    return md.listings(db, symbol)


@app.get("/api/stock/{symbol}/primary")
def stock_primary(symbol: str, db: Session = Depends(get_session)):
    """Home-market listing of a known security (used e.g. as logo fallback); null if unknown or itself."""
    return {"symbol": md.primary_symbol(db, symbol)}


@app.get("/api/stock/{symbol}")
def stock(symbol: str, db: Session = Depends(get_session)):
    symbol = symbol.upper()
    first_tx = db.scalar(select(func.min(Transaction.date)).where(Transaction.symbol == symbol))
    start = min(first_tx or dt.date.today(), dt.date.today() - dt.timedelta(days=365 * 10))
    prefetch = None
    if db.get(Security, symbol) is None:
        # New symbol: download price history while metadata is being fetched instead of afterwards.
        fetch_start = start - md.HISTORY_START_PADDING
        pool = ThreadPoolExecutor(max_workers=1)
        prefetch = (fetch_start, pool.submit(md.download_history, symbol, fetch_start))
        pool.shutdown(wait=False)
    try:
        sec = md.ensure_security(db, symbol)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    stale = not sec.history_updated_at or dt.datetime.utcnow() - sec.history_updated_at > dt.timedelta(hours=6)
    if stale or not sec.history_start or start < sec.history_start:
        try:
            prefetched = None
            if prefetch is not None:
                try:
                    prefetched = (prefetch[0], prefetch[1].result())
                except Exception as exc:
                    log.info("history prefetch failed for %s: %s", symbol, exc)
            md.update_history(db, symbol, start, prefetched=prefetched)
        except Exception as exc:
            db.rollback()
            log.warning("history update failed for %s: %s", symbol, exc)
    prices = db.execute(select(Price.date, Price.close).where(Price.symbol == symbol).order_by(Price.date)).all()
    divs = db.execute(select(DividendEvent.date, DividendEvent.amount).where(DividendEvent.symbol == symbol)
                      .order_by(DividendEvent.date)).all()
    p = get_portfolio(db)
    position = next((h for h in p.holdings(include_closed=True) if h["symbol"] == symbol), None)
    names = _names(db)
    txs = [tx_dict(t, names) for t in db.scalars(select(Transaction).where(Transaction.symbol == symbol)
                                                   .order_by(Transaction.date.desc()))]
    received = [r for r in p.dividends()["received"] if r["symbol"] == symbol]
    return {
        "security": security_dict(sec),
        "prices": [{"date": d.isoformat(), "close": round(c, 4)} for d, c in prices],
        "dividend_history": [{"date": d.isoformat(), "amount": a} for d, a in divs],
        "position": position,
        "transactions": txs,
        "dividends_received": received,
    }


# ---------------------------------------------------------------- watchlist

class WatchBody(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)


class WatchNote(BaseModel):
    note: Optional[str] = Field(default=None, max_length=2000)


def _num(v) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _future_date(v) -> Optional[str]:
    """First date (ISO string or epoch seconds, or a list of them) that is today or later."""
    today = dt.date.today()
    for x in v if isinstance(v, list) else [v]:
        try:
            d = dt.datetime.utcfromtimestamp(x).date() if isinstance(x, (int, float)) else dt.date.fromisoformat(str(x)[:10])
        except (TypeError, ValueError, OSError):
            continue
        if d >= today:
            return d.isoformat()
    return None


def _watch_row(db: Session, item: WatchlistItem, held: set) -> dict:
    sec = db.get(Security, item.symbol)
    today = dt.date.today()
    prices = db.execute(select(Price.date, Price.close).where(Price.symbol == item.symbol,
                                                              Price.date >= today - dt.timedelta(days=400))
                        .order_by(Price.date)).all()
    closes = [c for _, c in prices]
    last = closes[-1] if closes else None
    info = (security_dict(sec) or {}).get("info") or {}
    cal = info.get("calendar") or {}

    def sma(n: int, fallback) -> Optional[float]:
        return sum(closes[-n:]) / n if len(closes) >= n else _num(fallback)

    sma50 = sma(50, info.get("fiftyDayAverage"))
    sma200 = sma(200, info.get("twoHundredDayAverage"))
    divs = db.scalar(select(func.sum(DividendEvent.amount)).where(
        DividendEvent.symbol == item.symbol, DividendEvent.date > today - dt.timedelta(days=365))) or 0.0
    next_pay = _future_date(cal.get("Dividend Date"))
    ex_div = _future_date(cal.get("Ex-Dividend Date")) or _future_date(info.get("exDividendDate"))
    pct = lambda v: round(v * 100, 4) if _num(v) is not None else None  # noqa: E731
    return {
        "symbol": item.symbol,
        "name": sec.name if sec else item.symbol,
        "currency": sec.currency if sec else None,
        "quote_type": sec.quote_type if sec else None,
        "exchange": sec.exchange if sec else None,
        "sector": sec.sector if sec else None,
        "country": sec.country if sec else None,
        "note": item.note,
        "added_at": (item.added_at.date() if item.added_at else today).isoformat(),
        "held": item.symbol in held,
        "price": last,
        "history": [[d.isoformat(), round(c, 4)] for d, c in prices],
        "pe_ttm": _num(info.get("trailingPE")),
        "pe_fwd": _num(info.get("forwardPE")),
        "peg": _num(info.get("pegRatio")),
        "pb": _num(info.get("priceToBook")),
        "eps_ttm": _num(info.get("trailingEps")),
        "eps_fwd": _num(info.get("forwardEps")),
        "sma50": sma50,
        "sma200": sma200,
        "vs_sma50_pct": round((last / sma50 - 1) * 100, 4) if last and sma50 else None,
        "vs_sma200_pct": round((last / sma200 - 1) * 100, 4) if last and sma200 else None,
        "high_52w": max(closes[-252:]) if closes else _num(info.get("fiftyTwoWeekHigh")),
        "low_52w": min(closes[-252:]) if closes else _num(info.get("fiftyTwoWeekLow")),
        "shares_outstanding": _num(info.get("sharesOutstanding")),
        "insider_pct": pct(info.get("heldPercentInsiders")),
        "institutions_pct": pct(info.get("heldPercentInstitutions")),
        "short_pct": pct(info.get("shortPercentOfFloat")),
        "market_cap": _num(info.get("marketCap")),
        "beta": _num(info.get("beta")),
        "dividend_yield": round(divs / last * 100, 4) if last and divs else (0.0 if last else None),
        "dividend_rate": _num(info.get("dividendRate")),
        "payout_ratio": pct(info.get("payoutRatio")),
        "ex_dividend_date": ex_div,
        "next_payment_date": next_pay,
        "next_payment": _num(info.get("lastDividendValue")) if next_pay else None,
        "earnings_date": _future_date(cal.get("Earnings Date")),
        "target_price": _num(info.get("targetMeanPrice")),
        "recommendation": info.get("recommendationKey"),
        "revenue_growth": pct(info.get("revenueGrowth")),
        "profit_margin": pct(info.get("profitMargins")),
        "roe": pct(info.get("returnOnEquity")),
    }


def _held_symbols(db: Session) -> set:
    try:
        return {h["symbol"] for h in get_portfolio(db).holdings()}
    except Exception:  # empty portfolio
        return set()


@app.get("/api/watchlist")
def list_watchlist(db: Session = Depends(get_session)):
    held = _held_symbols(db)
    items = db.scalars(select(WatchlistItem).order_by(WatchlistItem.added_at.desc(), WatchlistItem.symbol)).all()
    return [_watch_row(db, i, held) for i in items]


@app.post("/api/watchlist", status_code=201)
def add_watchlist(body: WatchBody, db: Session = Depends(get_session)):
    symbol = body.symbol.upper().strip()
    try:
        sec = md.ensure_security(db, symbol)
        md.update_history(db, sec.symbol, md.watchlist_history_start())
    except ValueError as exc:
        db.rollback()
        raise HTTPException(404, str(exc))
    except Exception as exc:
        db.rollback()
        raise HTTPException(502, f"Market data error for {symbol}: {exc}")
    item = db.get(WatchlistItem, sec.symbol)
    if item is None:
        item = WatchlistItem(symbol=sec.symbol, added_at=dt.datetime.utcnow())
        db.add(item)
        db.commit()
    return _watch_row(db, item, _held_symbols(db))


@app.put("/api/watchlist/{symbol}/note")
def watchlist_note(symbol: str, body: WatchNote, db: Session = Depends(get_session)):
    item = db.get(WatchlistItem, symbol.upper())
    if item is None:
        raise HTTPException(404, "not in watchlist")
    item.note = (body.note or "").strip() or None
    db.commit()
    return {"symbol": item.symbol, "note": item.note}


@app.delete("/api/watchlist/{symbol}", status_code=204)
def remove_watchlist(symbol: str, db: Session = Depends(get_session)):
    item = db.get(WatchlistItem, symbol.upper())
    if item is None:
        raise HTTPException(404, "not in watchlist")
    db.delete(item)
    db.commit()


FIN_MAX_AGE = dt.timedelta(days=1)


def _cache_get(db: Session, key: str, max_age: dt.timedelta):
    hit = db.get(ApiCache, key)
    if hit and dt.datetime.utcnow() - hit.updated_at < max_age:
        return json.loads(hit.data_json)
    return None


def _cache_put(db: Session, key: str, data) -> None:
    db.merge(ApiCache(key=key, data_json=json.dumps(data), updated_at=dt.datetime.utcnow()))
    db.commit()


FIN_LAYOUT = {
    "income": [
        ("Revenue", ["Total Revenue", "Cost Of Revenue", "Gross Profit"]),
        ("Operating Expenses & Income", ["Operating Income", "Operating Expense", "Research And Development",
                                         "Selling General And Administration"]),
        ("Earnings from Continuing Operations", ["Interest Expense", "Interest Income", "Pretax Income", "Tax Provision"]),
        ("Net Income", ["Net Income", "Diluted EPS", "Diluted Average Shares"]),
        ("Supplemental", ["EBIT", "EBITDA"]),
    ],
    "balance": [
        ("Assets", ["Total Assets", "Current Assets", "Cash And Cash Equivalents", "Receivables", "Inventory",
                    "Total Non Current Assets", "Net PPE", "Goodwill And Other Intangible Assets"]),
        ("Liabilities", ["Total Liabilities Net Minority Interest", "Current Liabilities", "Total Debt",
                         "Long Term Debt", "Net Debt"]),
        ("Equity", ["Stockholders Equity", "Retained Earnings", "Ordinary Shares Number"]),
    ],
    "cashflow": [
        ("Operating Activities", ["Operating Cash Flow", "Depreciation And Amortization", "Stock Based Compensation",
                                  "Change In Working Capital"]),
        ("Investing Activities", ["Investing Cash Flow", "Capital Expenditure"]),
        ("Financing Activities", ["Financing Cash Flow", "Cash Dividends Paid", "Repurchase Of Capital Stock",
                                  "Repayment Of Debt", "Issuance Of Debt"]),
        ("Free Cash Flow", ["Free Cash Flow"]),
    ],
}
FIN_LABELS = {
    "Cost Of Revenue": "COGS", "Operating Expense": "Total Operating Expenses",
    "Research And Development": "R&D Expenses", "Selling General And Administration": "Selling General & Admin Expenses",
    "Tax Provision": "Income Tax Expense", "Total Liabilities Net Minority Interest": "Total Liabilities",
    "Goodwill And Other Intangible Assets": "Goodwill & Intangibles", "Ordinary Shares Number": "Shares Outstanding",
    "Diluted Average Shares": "Diluted Shares", "Net PPE": "Net PP&E",
}
PER_SHARE = {"Diluted EPS"}
SHARE_COUNTS = {"Diluted Average Shares", "Ordinary Shares Number"}


def _statement(annual: Optional[pd.DataFrame], quarterly: Optional[pd.DataFrame], layout, flow: bool) -> dict:
    if annual is None or annual.empty:
        return {"columns": [], "sections": []}
    cols = sorted(annual.columns)[-6:]
    labels = [str(c.year) for c in cols]
    ttm = None
    if quarterly is not None and not quarterly.empty:
        q = quarterly[sorted(quarterly.columns)[-4:]]
        if q.columns[-1] > cols[-1]:
            ttm = q
            labels.append("TTM" if flow else "Last Q")

    def cell(v):
        return float(v) if pd.notna(v) and abs(float(v)) != float("inf") else None

    sections = []
    for title, metrics in layout:
        rows = []
        for m in metrics:
            if m not in annual.index:
                continue
            vals = [cell(annual.at[m, c]) for c in cols]
            if ttm is not None:
                if m in ttm.index:
                    series = ttm.loc[m]
                    if flow and m not in SHARE_COUNTS:
                        vals.append(cell(series.sum()) if series.notna().all() and len(series) == 4 else None)
                    else:
                        vals.append(cell(series.iloc[-1]))
                else:
                    vals.append(None)
            if all(v is None for v in vals):
                continue
            kind = "per_share" if m in PER_SHARE else "shares" if m in SHARE_COUNTS else "money"
            rows.append({"key": m, "label": FIN_LABELS.get(m, m), "kind": kind, "values": vals})
        if rows:
            sections.append({"title": title, "rows": rows})
    return {"columns": labels, "sections": sections}


@app.get("/api/stock/{symbol}/financials")
def financials(symbol: str, db: Session = Depends(get_session)):
    symbol = symbol.upper()
    cached = _cache_get(db, f"financials:{symbol}", FIN_MAX_AGE)
    if cached is not None:
        return cached
    statements = (
        ("income", "income_stmt", "quarterly_income_stmt", True),
        ("balance", "balance_sheet", "quarterly_balance_sheet", False),
        ("cashflow", "cashflow", "quarterly_cashflow", True),
    )
    attrs = [a for _, annual, quarterly, _ in statements for a in (annual, quarterly)]

    def fetch(attr: str):
        try:
            return getattr(yf.Ticker(symbol), attr)
        except Exception as exc:
            log.warning("%s failed for %s: %s", attr, symbol, exc)
            return None

    # Each statement is a separate Yahoo request; fetching them concurrently cuts latency ~3x.
    with ThreadPoolExecutor(max_workers=len(attrs)) as pool:
        frames = dict(zip(attrs, pool.map(fetch, attrs)))
    result = {}
    for key, annual, quarterly, flow in statements:
        try:
            result[key] = _statement(frames[annual], frames[quarterly], FIN_LAYOUT[key], flow)
        except Exception as exc:
            log.warning("%s statement failed for %s: %s", key, symbol, exc)
            result[key] = {"columns": [], "sections": []}
    if any(s["sections"] for s in result.values()):
        _cache_put(db, f"financials:{symbol}", result)
    return result


INSIDER_MAX_AGE = dt.timedelta(hours=12)
INSIDER_KINDS = (("Purchase", "buy"), ("Sale", "sell"), ("Stock Award", "award"), ("Stock Gift", "gift"),
                 ("Conversion of Exercise", "exercise"))


def _insider_kind(text: str) -> str:
    return next((k for prefix, k in INSIDER_KINDS if text.startswith(prefix)), "other")


@app.get("/api/stock/{symbol}/insiders")
def insiders(symbol: str, db: Session = Depends(get_session)):
    """Insider trades (SEC Form 4 via Yahoo). Resolved and cached per ISIN, so every listing of a
    company (e.g. NVDA, NVD.DE) returns the same data, taken from its primary listing."""
    symbol = symbol.upper()
    try:
        sec = md.ensure_security(db, symbol)
    except ValueError as exc:
        raise HTTPException(404, str(exc))
    try:
        return _insider_data(db, sec)
    except Exception as exc:
        raise HTTPException(502, f"Insider data unavailable: {exc}")


_insider_refreshing: set = set()


def _refresh_insiders_async(symbol: str, key: str) -> None:
    if key in _insider_refreshing:
        return
    _insider_refreshing.add(key)

    def run():
        db = SessionLocal()
        try:
            sec = db.get(Security, symbol)
            if sec is not None:
                _insider_data(db, sec)
        except Exception as exc:
            log.info("background insider refresh failed for %s: %s", symbol, exc)
        finally:
            db.close()
            _insider_refreshing.discard(key)

    threading.Thread(target=run, daemon=True).start()


def _insider_data(db: Session, sec: Security, allow_stale: bool = False) -> dict:
    """With allow_stale, an expired cache entry is returned immediately and refreshed in the background."""
    symbol = sec.symbol
    isin = json.loads(sec.info_json or "{}").get("isin")
    key = f"insiders:{isin or symbol}"
    cached = _cache_get(db, key, INSIDER_MAX_AGE)
    if cached is not None:
        return cached
    if allow_stale:
        hit = db.get(ApiCache, key)
        if hit is not None:
            _refresh_insiders_async(symbol, key)
            return json.loads(hit.data_json)
    source = symbol
    if isin and sec.quote_type == "EQUITY":
        try:
            source = md._primary_listing(isin, symbol) or symbol
        except Exception as exc:
            log.info("primary listing lookup failed for %s: %s", symbol, exc)
    try:
        df = yf.Ticker(source).insider_transactions
    except Exception as exc:
        raise RuntimeError(str(exc)) from exc
    rows = []
    if df is not None and not df.empty:
        for r in df.to_dict("records"):
            text = str(r.get("Text") or "").strip()
            shares, value = (v if v is not None and math.isfinite(v) else None
                             for v in (_num(r.get("Shares")), _num(r.get("Value"))))
            when = r.get("Start Date")
            rows.append({
                "date": when.date().isoformat() if pd.notna(when) else None,
                "insider": str(r.get("Insider") or "").title(),
                "position": r.get("Position") or None,
                "kind": _insider_kind(text),
                "text": text or None,
                "shares": shares,
                "value": value or None,
                "price": value / shares if value and shares else None,
                "ownership": r.get("Ownership") or None,
            })
    currency = sec.currency
    if source != symbol:
        src = db.get(Security, source)
        try:
            currency = src.currency if src and src.currency else yf.Ticker(source).fast_info["currency"]
        except Exception:
            currency = None
    result = {"source": source, "currency": currency, "transactions": rows}
    _cache_put(db, key, result)
    return result


INSIDER_SUMMARY_MONTHS = 6
_EMPTY_INSIDER_SUMMARY = {"insider_buy_value": None, "insider_sell_value": None, "insider_net_value": None,
                          "insider_buys": None, "insider_sells": None, "insider_net_trades": None,
                          "insider_currency": None}


def insider_summary(data: Optional[dict], today: Optional[dt.date] = None) -> dict:
    """Open-market buys vs sells over the last INSIDER_SUMMARY_MONTHS. All None when no insider data exists
    for the company (e.g. non-SEC filers), zeros when it exists but there was no trading."""
    if not data or not data.get("transactions"):
        return dict(_EMPTY_INSIDER_SUMMARY)
    since = ((today or dt.date.today()) - dt.timedelta(days=round(INSIDER_SUMMARY_MONTHS * 30.44))).isoformat()
    recent = [t for t in data["transactions"] if (t.get("date") or "") >= since]
    buys = [t for t in recent if t["kind"] == "buy"]
    sells = [t for t in recent if t["kind"] == "sell"]
    buy_value = sum(t.get("value") or 0 for t in buys)
    sell_value = sum(t.get("value") or 0 for t in sells)
    return {"insider_buy_value": buy_value, "insider_sell_value": sell_value, "insider_net_value": buy_value - sell_value,
            "insider_buys": len(buys), "insider_sells": len(sells), "insider_net_trades": len(buys) - len(sells),
            "insider_currency": data.get("currency")}


def _insider_summaries(symbols: List[str]) -> dict:
    """Insider summaries for many symbols; uncached ones are fetched concurrently (one DB session each)."""
    def load(symbol: str):
        db = SessionLocal()
        try:
            sec = db.get(Security, symbol)
            if sec is None or sec.quote_type != "EQUITY":
                return symbol, None
            return symbol, _insider_data(db, sec, allow_stale=True)
        except Exception as exc:
            log.info("insider data unavailable for %s: %s", symbol, exc)
            return symbol, None
        finally:
            db.close()

    if not symbols:
        return {}
    with ThreadPoolExecutor(max_workers=min(8, len(symbols))) as pool:
        return {s: insider_summary(d) for s, d in pool.map(load, symbols)}


# ---------------------------------------------------------------- settings / status

@app.get("/api/settings")
def get_settings(db: Session = Depends(get_session)):
    return settings_mod.get_settings(db)


@app.put("/api/settings")
def put_settings(body: SettingsBody, db: Session = Depends(get_session)):
    if body.benchmark:
        body.benchmark = body.benchmark.upper().strip()
        try:
            md.prepare_symbol(db, body.benchmark, db.scalar(select(func.min(Transaction.date))) or dt.date.today() - dt.timedelta(days=3650))
        except Exception as exc:
            db.rollback()
            raise HTTPException(400, f"Invalid benchmark: {exc}")
    return settings_mod.update_settings(db, body.model_dump())


@app.get("/api/status")
def status():
    return {**md.refresh_state, "base_currency": md.BASE_CURRENCY}


@app.post("/api/refresh", status_code=202)
def refresh(force_info: bool = False):
    if md.refresh_state["running"]:
        return {"status": "already-running"}
    md.refresh_state["running"] = True
    _background_refresh(force_info=force_info)
    return {"status": "started"}


# ---------------------------------------------------------------- frontend

STATIC_DIR = Path(os.environ.get("STONKSFOLIO_STATIC_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))

if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404)
        f = (STATIC_DIR / path).resolve()
        if path and f.is_relative_to(STATIC_DIR.resolve()) and f.is_file():
            return FileResponse(f)
        return FileResponse(STATIC_DIR / "index.html")
