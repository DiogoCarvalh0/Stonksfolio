"""Market data access (Yahoo Finance via yfinance), cached in SQLite."""
from __future__ import annotations

import datetime as dt
import json
import logging
import math
import re
import threading
from typing import Dict, Iterable, List, Optional

import pandas as pd
import yfinance as yf
from sqlalchemy import delete, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from .models import DividendEvent, Price, Security, SplitEvent, Transaction, WatchlistItem

log = logging.getLogger(__name__)

BASE_CURRENCY = "EUR"
# Yahoo quotes some exchanges in minor units.
MINOR_CURRENCIES = {"GBp": ("GBP", 0.01), "GBX": ("GBP", 0.01), "ZAc": ("ZAR", 0.01), "ILA": ("ILS", 0.01)}
INFO_MAX_AGE = dt.timedelta(days=7)
HISTORY_START_PADDING = dt.timedelta(days=10)

SECTOR_KEYS = {
    "realestate": "Real Estate",
    "consumer_cyclical": "Consumer Cyclical",
    "basic_materials": "Basic Materials",
    "consumer_defensive": "Consumer Defensive",
    "technology": "Technology",
    "communication_services": "Communication Services",
    "financial_services": "Financial Services",
    "utilities": "Utilities",
    "industrials": "Industrials",
    "energy": "Energy",
    "healthcare": "Healthcare",
}

INFO_KEYS = [
    "longName", "shortName", "currency", "quoteType", "sector", "industry", "country", "exchange",
    "fullExchangeName", "marketCap", "trailingPE", "forwardPE", "priceToBook", "beta", "dividendRate",
    "trailingAnnualDividendRate", "trailingAnnualDividendYield", "payoutRatio", "exDividendDate",
    "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "fiftyDayAverage", "twoHundredDayAverage", "trailingEps",
    "forwardEps", "revenueGrowth", "earningsGrowth", "profitMargins", "operatingMargins", "returnOnEquity",
    "debtToEquity", "totalRevenue", "freeCashflow", "longBusinessSummary", "website", "fullTimeEmployees",
    "category", "fundFamily", "totalAssets", "netExpenseRatio", "annualReportExpenseRatio", "ytdReturn",
    "targetMeanPrice", "recommendationKey", "numberOfAnalystOpinions", "regularMarketPrice",
    "previousClose", "averageVolume", "financialCurrency", "dividendYield", "fiveYearAvgDividendYield",
    "lastDividendValue", "pegRatio", "enterpriseToEbitda", "priceToSalesTrailing12Months",
    "sharesOutstanding", "heldPercentInsiders", "heldPercentInstitutions", "shortPercentOfFloat",
]
# Bump when INFO_KEYS (or how they are derived) changes so cached metadata is refetched.
INFO_VERSION = 4

# Fundamentals are per company, but Yahoo only fills many of them (analyst estimates, forward P/E, ...)
# on the primary listing. Secondary listings (e.g. FB2A.DE for META) borrow missing ones from it.
# Never borrowed: quote/listing-specific fields.
LISTING_KEYS = {
    "longName", "shortName", "currency", "quoteType", "exchange", "fullExchangeName", "fiftyTwoWeekHigh",
    "fiftyTwoWeekLow", "fiftyDayAverage", "twoHundredDayAverage", "regularMarketPrice", "previousClose",
    "averageVolume",
}
# Amounts quoted in the listing's trading currency: scaled by the price ratio between the listings.
PRICE_DENOMINATED_KEYS = {
    "marketCap", "trailingEps", "forwardEps", "targetMeanPrice", "dividendRate",
    "trailingAnnualDividendRate", "lastDividendValue",
}
# Yahoo suffix of the home exchange per ISIN country ("" = US listing without suffix).
HOME_SUFFIX = {
    "US": "", "CA": ".TO", "NL": ".AS", "DE": ".DE", "FR": ".PA", "GB": ".L", "IT": ".MI", "ES": ".MC",
    "CH": ".SW", "BE": ".BR", "PT": ".LS", "DK": ".CO", "SE": ".ST", "NO": ".OL", "FI": ".HE", "AT": ".VI",
    "IE": ".IR", "AU": ".AX", "HK": ".HK", "JP": ".T",
}

COUNTRY_ISO = {
    "United States": "US", "Netherlands": "NL", "Germany": "DE", "France": "FR", "United Kingdom": "GB",
    "Denmark": "DK", "Switzerland": "CH", "Spain": "ES", "Italy": "IT", "Portugal": "PT", "Belgium": "BE",
    "Sweden": "SE", "Norway": "NO", "Finland": "FI", "Ireland": "IE", "Austria": "AT", "Luxembourg": "LU",
    "Canada": "CA", "Japan": "JP", "Australia": "AU", "Hong Kong": "HK", "China": "CN", "Taiwan": "TW",
    "Jersey": "JE", "Bermuda": "BM", "Cayman Islands": "KY",
}


FUND_ISIN_PREFIXES = ("IE", "LU", "DE", "FR", "NL", "US", "GB", "CH")
# Bump to re-run the ISIN lookup for securities cached with an older (less capable) lookup.
ISIN_LOOKUP_VERSION = 3


def _plausible_isin(isin: Optional[str], info: dict) -> bool:
    """Reject depositary receipts / foreign copies whose ISIN country doesn't match the security."""
    if not isin or not is_isin(isin):
        return False
    if info.get("quoteType") in ("ETF", "MUTUALFUND"):
        return isin[:2] in FUND_ISIN_PREFIXES
    if not info.get("country"):  # secondary listings often lack the country; can't cross-check
        return True
    expected = COUNTRY_ISO.get(info["country"])
    return bool(expected) and isin.startswith(expected)


_NAME_NOISE = re.compile(
    r"\b(the|inc|incorporated|corp|corporation|company|co|plc|ltd|limited|n\.?v|s\.?a|s\.?e|a\.?g|ag|se|sa|nv|holdings?|group)\b\.?",
    re.IGNORECASE,
)


def _clean_company_name(name: str) -> str:
    name = re.sub(r"\(.*?\)", " ", name)
    name = _NAME_NOISE.sub(" ", name)
    return re.sub(r"[\s,]+", " ", name).strip(" .,")


def _onvista_isin(symbol: str, info: dict) -> Optional[str]:
    """ISIN via onvista's instrument search (covers European listings and UCITS ETFs)."""
    import requests

    fund = info.get("quoteType") in ("ETF", "MUTUALFUND")
    want = "FUND" if fund else "STOCK"
    long_name = info.get("longName") or info.get("shortName") or ""
    clean = _clean_company_name(long_name)
    key_word = next((w for w in re.split(r"[\s,.]+", clean.upper()) if len(w) > 1), "")
    queries = [q for q in (symbol.split(".")[0].split("-")[0], clean, long_name) if q]
    if fund:  # fund tickers rarely match; the full name pins the share class (Acc/Dist, hedged)
        queries = [q for q in (long_name, clean) if q]
    for q in dict.fromkeys(queries):
        try:
            resp = requests.get("https://api.onvista.de/api/v1/instruments/query",
                                params={"searchValue": q, "limit": 10}, timeout=8,
                                headers={"User-Agent": "Mozilla/5.0"})
            resp.raise_for_status()
            rows = resp.json().get("list") or []
        except Exception as exc:  # pragma: no cover - network
            log.info("onvista ISIN lookup failed for %s: %s", symbol, exc)
            return None
        for r in rows:
            name = (r.get("name") or "").upper()
            if r.get("entityType") != want or "(ADR)" in name or "(CDR" in name:
                continue
            if key_word and key_word not in name:
                continue
            if _plausible_isin(r.get("isin"), info):
                return r["isin"]
    return None


def _fetch_isin(t: "yf.Ticker", info: dict) -> Optional[str]:
    hint = _isin_hints.get(t.ticker.upper())
    if hint:
        return hint
    isin = _onvista_isin(t.ticker, info)
    if isin:
        return isin
    try:
        isin = t.isin
    except Exception:
        return None
    return isin if _plausible_isin(isin, info) else None

_refresh_lock = threading.Lock()
refresh_state: Dict[str, object] = {"running": False, "last_run": None, "last_error": None}


def normalize_currency(cur: Optional[str]) -> tuple[str, float]:
    """Return (major currency, multiplier) e.g. GBp -> (GBP, 0.01)."""
    if not cur:
        return BASE_CURRENCY, 1.0
    if cur in MINOR_CURRENCIES:
        return MINOR_CURRENCIES[cur]
    return cur.upper(), 1.0


def fx_symbol(currency: str) -> str:
    return f"{BASE_CURRENCY}{currency}=X"


def _clean(v):
    if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
        return None
    return v


def _to_date(idx) -> dt.date:
    ts = pd.Timestamp(idx)
    return ts.date()


# ---------------------------------------------------------------- search

ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")


def is_isin(value: str) -> bool:
    """True if value is a syntactically valid ISIN (including the Luhn check digit)."""
    value = value.strip().upper()
    if not ISIN_RE.match(value):
        return False
    digits = "".join(str(int(c, 36)) for c in value[:-1])
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return (10 - total % 10) % 10 == int(value[-1])


def _yahoo_search(query: str, limit: int) -> List[dict]:
    try:
        quotes = yf.Search(query, max_results=limit, news_count=0).quotes or []
    except Exception as exc:  # pragma: no cover - network
        log.warning("search failed: %s", exc)
        return []
    out = []
    for q in quotes:
        if q.get("quoteType") not in ("EQUITY", "ETF", "MUTUALFUND", "INDEX"):
            continue
        out.append({
            "symbol": q.get("symbol"),
            "name": q.get("longname") or q.get("shortname") or q.get("symbol"),
            "exchange": q.get("exchDisp") or q.get("exchange"),
            "type": q.get("quoteType"),
        })
    return out


# Bloomberg exchange codes (as returned by OpenFIGI) -> Yahoo Finance ticker suffix.
# Ordered by preference: the first listings found are shown first.
FIGI_EXCHANGES = {
    "US": "", "GY": ".DE", "NA": ".AS", "LN": ".L", "FP": ".PA", "IM": ".MI", "SM": ".MC",
    "SW": ".SW", "SE": ".SW", "BB": ".BR", "PL": ".LS", "DC": ".CO", "SS": ".ST", "NO": ".OL",
    "FH": ".HE", "AV": ".VI", "ID": ".IR", "GR": ".F", "GS": ".SG", "GM": ".MU", "CN": ".TO",
    "AU": ".AX", "HK": ".HK", "JT": ".T",
}
_isin_cache: Dict[str, List[dict]] = {}
# Symbols found through an ISIN search -> that ISIN (lets their metadata keep the ISIN the user searched with).
_isin_hints: Dict[str, str] = {}

# Exchange names / MIC / common broker codes -> Yahoo Finance ticker suffix (used by the CSV import).
_EXCHANGE_GROUPS = {
    "": ("US", "USA", "NASDAQ", "NASDAQGS", "NASDAQGM", "NASDAQCM", "NMS", "NGM", "NCM", "XNAS", "NYSE", "NYQ",
         "XNYS", "NYSEARCA", "NYSE ARCA", "ARCA", "ARCX", "PCX", "AMEX", "NYSE AMERICAN", "NYSEAMERICAN", "ASE",
         "XASE", "BATS", "CBOE", "BZX", "OTC", "OTCMKTS", "PNK"),
    ".AS": ("AS", "AMS", "AEB", "XAMS", "EURONEXT AMSTERDAM", "AMSTERDAM", "ENXTAM"),
    ".DE": ("DE", "XETRA", "XETR", "ETR", "GER", "XGAT", "TRADEGATE", "TDG"),
    ".F": ("F", "FRA", "XFRA", "FRANKFURT"),
    ".MU": ("MU", "MUN", "XMUN", "MUNICH", "GETTEX"),
    ".SG": ("SG", "STU", "XSTU", "STUTTGART"),
    ".BE": ("BE", "BER", "XBER", "BERLIN"),
    ".DU": ("DU", "DUS", "XDUS", "DUSSELDORF"),
    ".HM": ("HM", "HAM", "XHAM", "HAMBURG"),
    ".PA": ("PA", "EPA", "PAR", "XPAR", "EURONEXT PARIS", "PARIS", "ENXTPA"),
    ".BR": ("BR", "EBR", "BRU", "XBRU", "EURONEXT BRUSSELS", "BRUSSELS", "ENXTBR"),
    ".LS": ("LS", "ELI", "LIS", "XLIS", "EURONEXT LISBON", "LISBON", "ENXTLS"),
    ".IR": ("IR", "ISE", "XDUB", "EURONEXT DUBLIN", "DUBLIN"),
    ".MI": ("MI", "BIT", "MIL", "XMIL", "BORSA ITALIANA", "MILAN"),
    ".MC": ("MC", "BME", "MCE", "XMAD", "MADRID"),
    ".L": ("L", "LSE", "LON", "XLON", "LONDON"),
    ".SW": ("SW", "SIX", "SWX", "XSWX", "VTX", "EBS"),
    ".VI": ("VI", "VIE", "XWBO", "WBAG", "VIENNA"),
    ".CO": ("CO", "CPH", "XCSE", "COPENHAGEN"),
    ".ST": ("ST", "STO", "XSTO", "STOCKHOLM"),
    ".OL": ("OL", "OSL", "OSE", "XOSL", "OSLO"),
    ".HE": ("HE", "HEL", "XHEL", "HELSINKI"),
    ".WA": ("WA", "WSE", "XWAR", "WARSAW"),
    ".TO": ("TO", "TSX", "TOR", "XTSE", "TORONTO"),
    ".V": ("V", "TSXV", "CVE", "XTSX"),
    ".AX": ("AX", "ASX", "XASX"),
    ".HK": ("HK", "HKEX", "HKG", "XHKG"),
    ".T": ("T", "TYO", "JPX", "XTKS", "TOKYO"),
}
EXCHANGE_SUFFIX = {name: suffix for suffix, names in _EXCHANGE_GROUPS.items() for name in names}


def exchange_suffix(exchange: str) -> str:
    """Yahoo suffix (e.g. '.AS', '' for US) for an exchange name/code; raises ValueError if unknown."""
    key = " ".join(exchange.strip().upper().lstrip(".").split())
    if key not in EXCHANGE_SUFFIX:
        raise ValueError(f"unknown exchange '{exchange.strip()}'")
    return EXCHANGE_SUFFIX[key]


def symbol_for_exchange(ticker: str, exchange: Optional[str]) -> str:
    """Combine a plain ticker and an exchange into a Yahoo Finance symbol (ASML + AMS -> ASML.AS)."""
    ticker = ticker.strip().upper()
    if not exchange or not exchange.strip() or is_isin(ticker):
        return ticker
    suffix = exchange_suffix(exchange)
    if suffix == "":
        return ticker.replace(".", "-")  # BRK.B -> BRK-B
    return ticker if ticker.endswith(suffix) else ticker + suffix


def _openfigi_symbols(isin: str) -> List[str]:
    """Candidate Yahoo symbols for an ISIN, via the free OpenFIGI mapping API."""
    import requests

    try:
        resp = requests.post(
            "https://api.openfigi.com/v3/mapping",
            json=[{"idType": "ID_ISIN", "idValue": isin}],
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()[0].get("data") or []
    except Exception as exc:  # pragma: no cover - network
        log.warning("OpenFIGI lookup failed for %s: %s", isin, exc)
        return []
    found: Dict[str, str] = {}
    for row in data:
        suffix = FIGI_EXCHANGES.get(row.get("exchCode", ""))
        ticker = (row.get("ticker") or "").strip().rstrip("/").replace("/", "-").replace(" ", "-")
        if suffix is None or not ticker or "*" in ticker:
            continue
        found.setdefault(row["exchCode"], ticker + suffix)
        if row["exchCode"] == "GR":  # German composite: the Xetra listing usually shares the ticker
            found.setdefault("GY", ticker + ".DE")
    order = list(FIGI_EXCHANGES)
    if not isin.startswith(("US", "CA")):  # US listings of foreign securities are OTC copies
        order.append(order.pop(order.index("US")))
    return [found[k] for k in sorted(found, key=order.index)]


def _confirm_on_yahoo(symbol: str) -> Optional[dict]:
    for r in _yahoo_search(symbol, 5):
        if r["symbol"].upper() == symbol.upper():
            return r
    return None


def search_isin(isin: str, limit: int = 20) -> List[dict]:
    isin = isin.upper()
    if isin in _isin_cache:
        return _isin_cache[isin]
    from concurrent.futures import ThreadPoolExecutor

    results: Dict[str, dict] = {}
    for r in _yahoo_search(isin, limit):
        if not r["symbol"].upper().startswith(isin):  # skip pseudo-symbols like IE00...SG
            results[r["symbol"]] = r
    candidates = [s for s in _openfigi_symbols(isin) if s not in results][:limit]
    with ThreadPoolExecutor(max_workers=6) as pool:
        for r in pool.map(_confirm_on_yahoo, candidates):
            if r:
                results.setdefault(r["symbol"], r)
    out = list(results.values())[:limit]
    for r in out:
        r["isin"] = isin
        _isin_hints[r["symbol"].upper()] = isin
    if out:
        _isin_cache[isin] = out
    return out


def search(query: str, limit: int = 20) -> List[dict]:
    query = query.strip()
    if not query:
        return []
    if is_isin(query):
        return search_isin(query, limit)
    return _yahoo_search(query, limit)

def _primary_listing(isin: str, symbol: str) -> Optional[str]:
    """Symbol of the home-market listing for an ISIN (None if `symbol` already is it)."""
    listings = [r["symbol"] for r in search_isin(isin) if r.get("type") == "EQUITY" and r.get("symbol")]
    suffix = HOME_SUFFIX.get(isin[:2])
    home = [s for s in listings if suffix is not None and
            (("." not in s) if suffix == "" else s.upper().endswith(suffix))]
    primary = (home or listings or [None])[0]
    return None if not primary or primary.upper() == symbol.upper() else primary


def primary_symbol(db: Session, symbol: str) -> Optional[str]:
    """Home-market listing of a cached security (None if unknown or `symbol` already is it)."""
    sec = db.get(Security, symbol.upper())
    if sec is None:
        return None
    info = json.loads(sec.info_json or "{}")
    if "primary_symbol" in info:
        return info["primary_symbol"]
    isin = info.get("isin")
    try:
        primary = _primary_listing(isin, sec.symbol) if isin and info.get("quoteType") == "EQUITY" else None
    except Exception as exc:  # pragma: no cover - network
        log.info("primary listing lookup failed for %s: %s", symbol, exc)
        return None
    info["primary_symbol"] = primary
    sec.info_json = json.dumps(info)
    db.commit()
    return primary


_listing_currency_cache: Dict[str, Optional[str]] = {}


def _listing_currency(symbol: str) -> Optional[str]:
    if symbol not in _listing_currency_cache:
        try:
            _listing_currency_cache[symbol] = yf.Ticker(symbol).fast_info["currency"]
        except Exception:  # pragma: no cover - network
            return None
    return _listing_currency_cache[symbol]


def listings(db: Session, symbol: str) -> List[dict]:
    """All exchange listings of the same security (same ISIN), the primary (home) listing first."""
    from concurrent.futures import ThreadPoolExecutor

    sec = db.get(Security, symbol.upper())
    if sec is None:
        return []
    info = json.loads(sec.info_json or "{}")
    isin = info.get("isin")
    current = {"symbol": sec.symbol, "name": sec.name, "exchange": sec.exchange or info.get("exchange"),
               "type": sec.quote_type, "currency": sec.currency}
    rows = [dict(r) for r in search_isin(isin) if r.get("type") == sec.quote_type] if isin else []
    if not any(r["symbol"].upper() == sec.symbol for r in rows):
        rows.insert(0, current)
    known = dict(db.execute(select(Security.symbol, Security.currency)
                            .where(Security.symbol.in_([r["symbol"].upper() for r in rows]))).all())
    missing = [r["symbol"] for r in rows if not known.get(r["symbol"].upper())]
    with ThreadPoolExecutor(max_workers=8) as pool:
        fetched = dict(zip(missing, pool.map(_listing_currency, missing)))
    primary = (primary_symbol(db, sec.symbol) or sec.symbol).upper() if isin else sec.symbol
    for r in rows:
        r["currency"] = known.get(r["symbol"].upper()) or fetched.get(r["symbol"]) or r.get("currency")
        r["primary"] = r["symbol"].upper() == primary
    return sorted(rows, key=lambda r: not r["primary"])


def _fx_factor(src: Optional[str], dst: Optional[str]) -> Optional[float]:
    """Multiplier converting an amount quoted in `src` into `dst` (handles minor units like GBp)."""
    if not src or not dst:
        return None
    (s_cur, s_mult), (d_cur, d_mult) = normalize_currency(src), normalize_currency(dst)
    if s_cur == d_cur:
        return s_mult / d_mult
    try:
        rate = _clean(yf.Ticker(f"{s_cur}{d_cur}=X").fast_info["last_price"])
    except Exception:  # pragma: no cover - network
        return None
    return s_mult * rate / d_mult if rate else None


def _fill_from_primary(symbol: str, data: dict) -> None:
    """Use the primary listing's company fundamentals on secondary listings.

    Yahoo's data for secondary listings is often missing or stale (e.g. a wrong forward EPS on FRI.F), so
    company-level values always come from the home listing, price-denominated ones converted to this listing.
    """
    isin = data.get("isin")
    if data.get("quoteType") != "EQUITY" or not isin:
        return
    primary = _primary_listing(isin, symbol)
    data["primary_symbol"] = primary
    if not primary:
        return
    try:
        t = yf.Ticker(primary)
        info = t.info or {}
    except Exception as exc:  # pragma: no cover - network
        log.info("primary listing %s unavailable for %s: %s", primary, symbol, exc)
        return
    factor = _fx_factor(info.get("currency"), data.get("currency"))
    if factor is None:  # fall back to the ratio between the two listings' prices
        own_px = data.get("regularMarketPrice") or data.get("previousClose")
        src_px = _clean(info.get("regularMarketPrice")) or _clean(info.get("previousClose"))
        factor = own_px / src_px if own_px and src_px else None
    filled = []
    for k in (k for k in INFO_KEYS if k not in LISTING_KEYS):
        v = _clean(info.get(k))
        if v is None:
            continue
        if k in PRICE_DENOMINATED_KEYS:
            if factor is None or not isinstance(v, (int, float)):
                continue
            v = v * factor
        data[k] = v
        filled.append(k)
    data["calendar"] = _fetch_calendar(t) or data.get("calendar") or {}
    if filled:
        data["fundamentals_from"] = primary
        log.info("%s: filled %s from primary listing %s", symbol, ", ".join(filled), primary)


def _fetch_calendar(t: "yf.Ticker") -> dict:
    try:
        cal = t.calendar or {}
        return {
            k: (v.isoformat() if isinstance(v, dt.date) else [x.isoformat() for x in v] if isinstance(v, list) else _clean(v))
            for k, v in cal.items()
            if k in ("Dividend Date", "Ex-Dividend Date", "Earnings Date")
        }
    except Exception:
        return {}


# ---------------------------------------------------------------- security info

def fetch_info(symbol: str) -> dict:
    t = yf.Ticker(symbol)
    try:
        info = t.info or {}
    except Exception as exc:
        log.info("info unavailable for %s (%s); using history metadata", symbol, exc)
        info = {}
    if not info.get("currency"):
        # Some ETFs have no "fundamentals" on Yahoo; chart metadata still has the basics.
        try:
            t.history(period="5d", raise_errors=False)
            m = t.history_metadata or {}
        except Exception:
            m = {}
        if m.get("currency"):
            info = {**info, "currency": m.get("currency"), "longName": info.get("longName") or m.get("longName"),
                    "shortName": info.get("shortName") or m.get("shortName"),
                    "quoteType": info.get("quoteType") or m.get("instrumentType"),
                    "exchange": m.get("exchangeName"), "fullExchangeName": m.get("fullExchangeName")}
    data = {k: _clean(info.get(k)) for k in INFO_KEYS}
    data["isin"] = _fetch_isin(t, data) if data.get("quoteType") in ("EQUITY", "ETF", "MUTUALFUND") else None
    data["isin_v"] = ISIN_LOOKUP_VERSION
    data["info_v"] = INFO_VERSION
    data["calendar"] = _fetch_calendar(t)
    try:
        _fill_from_primary(symbol, data)
    except Exception as exc:  # enrichment is best effort
        log.warning("primary-listing enrichment failed for %s: %s", symbol, exc)
    return data


def fetch_sector_weights(symbol: str) -> Optional[dict]:
    try:
        w = yf.Ticker(symbol).funds_data.sector_weightings or {}
    except Exception:
        return None
    w = {SECTOR_KEYS.get(k, k): float(v) for k, v in w.items() if v}
    return w or None


def ensure_security(db: Session, symbol: str, force: bool = False) -> Security:
    """Create/refresh security metadata. Raises ValueError if symbol is unknown."""
    symbol = symbol.upper().strip()
    sec = db.get(Security, symbol)
    now = dt.datetime.utcnow()
    cached = json.loads(sec.info_json or "{}") if sec else {}
    if sec and not force and sec.info_updated_at and now - sec.info_updated_at < INFO_MAX_AGE \
            and cached.get("info_v") == INFO_VERSION:
        info = cached
        if info.get("isin") or info.get("isin_v") == ISIN_LOOKUP_VERSION:
            return sec
        # metadata is fresh; only (re)try the ISIN lookup
        info["isin"] = _fetch_isin(yf.Ticker(symbol), info) if info.get("quoteType") in ("EQUITY", "ETF", "MUTUALFUND") else None
        info["isin_v"] = ISIN_LOOKUP_VERSION
        sec.info_json = json.dumps(info)
        db.commit()
        if not info["isin"]:
            return sec
        # a newly found ISIN can fill fundamentals from the primary listing: do a full refresh
    try:
        info = fetch_info(symbol)
    except Exception as exc:
        if sec:
            log.warning("info refresh failed for %s: %s", symbol, exc)
            return sec
        raise ValueError(f"Could not fetch data for {symbol}: {exc}") from exc
    if not info.get("currency") or not (info.get("longName") or info.get("shortName") or info.get("quoteType")):
        if sec:
            return sec
        raise ValueError(f"Unknown symbol: {symbol}")
    if sec is None:
        sec = Security(symbol=symbol)
        db.add(sec)
    sec.name = info.get("longName") or info.get("shortName") or symbol
    sec.currency = info.get("currency")
    sec.quote_type = info.get("quoteType")
    sec.sector = info.get("sector")
    sec.industry = info.get("industry")
    sec.country = info.get("country")
    sec.exchange = info.get("fullExchangeName") or info.get("exchange")
    sec.info_json = json.dumps(info)
    if sec.quote_type in ("ETF", "MUTUALFUND"):
        w = fetch_sector_weights(symbol)
        if w:
            sec.sector_weights_json = json.dumps(w)
    sec.info_updated_at = now
    db.commit()
    return sec


# ---------------------------------------------------------------- price history

def _upsert(db: Session, model, rows: List[dict], value_col: str):
    if not rows:
        return
    for i in range(0, len(rows), 500):
        chunk = rows[i:i + 500]
        stmt = sqlite_insert(model).values(chunk)
        stmt = stmt.on_conflict_do_update(
            index_elements=["symbol", "date"], set_={value_col: getattr(stmt.excluded, value_col)}
        )
        db.execute(stmt)


def download_history(symbol: str, fetch_start: dt.date) -> Optional[pd.DataFrame]:
    return yf.Ticker(symbol).history(
        start=fetch_start.isoformat(),
        end=(dt.date.today() + dt.timedelta(days=1)).isoformat(),
        auto_adjust=False, actions=True, raise_errors=False,
    )


def update_history(db: Session, symbol: str, start: dt.date, full: bool = False,
                   prefetched: Optional[tuple] = None) -> int:
    """Fetch daily closes (split-adjusted, not dividend-adjusted), dividends and splits.

    `prefetched` is an optional (fetch_start, DataFrame) already downloaded with download_history;
    it is used when it covers the range this call would fetch.
    """
    sec = db.get(Security, symbol)
    if sec is None:  # e.g. FX pairs: track fetch state only
        sec = Security(symbol=symbol, name=symbol, quote_type="CURRENCY" if symbol.endswith("=X") else None)
        db.add(sec)
        db.flush()
    last = db.scalar(select(func.max(Price.date)).where(Price.symbol == symbol))
    need_backfill = sec.history_start is None or start < sec.history_start
    if full or need_backfill or last is None:
        fetch_start = start - HISTORY_START_PADDING
        full = True
    else:
        fetch_start = last - dt.timedelta(days=7)

    if prefetched is not None and prefetched[0] <= fetch_start:
        fetch_start, hist = prefetched
    else:
        hist = download_history(symbol, fetch_start)
    if hist is None or hist.empty:
        db.commit()
        return 0

    if not full and "Stock Splits" in hist:
        known = {d for (d,) in db.execute(select(SplitEvent.date).where(SplitEvent.symbol == symbol))}
        new_splits = [_to_date(i) for i, v in hist["Stock Splits"].items() if v and v != 0 and _to_date(i) not in known]
        if new_splits:
            # A new split rewrites all historical (split-adjusted) closes: refetch everything.
            log.info("new split for %s, refetching full history", symbol)
            return update_history(db, symbol, start, full=True)

    if full:
        db.execute(delete(Price).where(Price.symbol == symbol))
        db.execute(delete(DividendEvent).where(DividendEvent.symbol == symbol))
        db.execute(delete(SplitEvent).where(SplitEvent.symbol == symbol))

    price_rows, div_rows, split_rows = {}, {}, {}
    for idx, row in hist.iterrows():
        d = _to_date(idx)
        close = row.get("Close")
        if close is not None and not pd.isna(close) and close > 0:
            price_rows[d] = {"symbol": symbol, "date": d, "close": float(close)}
        div = row.get("Dividends", 0)
        if div and not pd.isna(div) and div > 0:
            div_rows[d] = {"symbol": symbol, "date": d, "amount": float(div)}
        sp = row.get("Stock Splits", 0)
        if sp and not pd.isna(sp) and sp > 0:
            split_rows[d] = {"symbol": symbol, "date": d, "ratio": float(sp)}

    _upsert(db, Price, list(price_rows.values()), "close")
    _upsert(db, DividendEvent, list(div_rows.values()), "amount")
    _upsert(db, SplitEvent, list(split_rows.values()), "ratio")
    sec.history_updated_at = dt.datetime.utcnow()
    if full:
        sec.history_start = fetch_start
    db.commit()
    return len(price_rows)


def required_currencies(db: Session, extra: Iterable[str] = ()) -> set:
    curs = set()
    for (c,) in db.execute(select(Security.currency)):
        curs.add(normalize_currency(c)[0])
    for (c,) in db.execute(select(Transaction.currency).distinct()):
        curs.add(normalize_currency(c)[0])
    curs.update(normalize_currency(c)[0] for c in extra)
    curs.discard(BASE_CURRENCY)
    return curs


def watchlist_history_start() -> dt.date:
    """Watchlist symbols keep ~13 months of history (enough for 1Y change and TTM dividends)."""
    return dt.date.today() - dt.timedelta(days=400)


def refresh_all(db: Session, symbols_extra: Iterable[str] = (), force_info: bool = False) -> dict:
    """Refresh metadata + history for every traded symbol, FX pairs and extras (benchmark)."""
    from . import settings as settings_mod

    if not _refresh_lock.acquire(blocking=False):
        return {"status": "already-running"}
    refresh_state["running"] = True
    errors = []
    try:
        start_by_symbol = dict(db.execute(select(Transaction.symbol, func.min(Transaction.date)).group_by(Transaction.symbol)).all())
        first_date = min(start_by_symbol.values()) if start_by_symbol else dt.date.today() - dt.timedelta(days=365 * 5)
        benchmark = settings_mod.get_settings(db)["benchmark"]
        # Keep at least ~13 months for every holding so 200-day averages (Dip Finder) are available.
        symbols = {s: min(d, watchlist_history_start()) for s, d in start_by_symbol.items()}
        for s in [benchmark, *symbols_extra]:
            if s:
                symbols.setdefault(s.upper(), first_date)
        for (s,) in db.execute(select(WatchlistItem.symbol)):
            symbols.setdefault(s, watchlist_history_start())
        for sym, start in symbols.items():
            try:
                ensure_security(db, sym, force=force_info)
                update_history(db, sym, start)
            except Exception as exc:
                db.rollback()
                log.warning("refresh failed for %s: %s", sym, exc)
                errors.append(f"{sym}: {exc}")
        for cur in required_currencies(db):
            try:
                update_history(db, fx_symbol(cur), first_date)
            except Exception as exc:
                db.rollback()
                errors.append(f"FX {cur}: {exc}")
        refresh_state["last_error"] = "; ".join(errors) or None
        refresh_state["last_run"] = dt.datetime.utcnow().isoformat() + "Z"
        settings_mod.bump_version()
        return {"status": "ok", "errors": errors}
    finally:
        refresh_state["running"] = False
        _refresh_lock.release()


def prepare_symbol(db: Session, symbol: str, start: dt.date, currency: Optional[str] = None) -> Security:
    """Make sure a newly used symbol has metadata, history and FX history."""
    sec = ensure_security(db, symbol)
    update_history(db, sec.symbol, start)
    for cur in {normalize_currency(sec.currency)[0], normalize_currency(currency)[0]}:
        if cur != BASE_CURRENCY:
            update_history(db, fx_symbol(cur), start)
    return sec
