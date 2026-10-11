"""CNN Fear & Greed index (market sentiment), fetched from CNN's public data feed and cached briefly."""
from __future__ import annotations

import datetime as dt
import json
import ssl
import threading
import time
import urllib.request

import certifi

URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    "Accept": "application/json",
    "Referer": "https://edition.cnn.com/",
    "Origin": "https://edition.cnn.com",
}
TTL = 600

INDICATORS = [
    ("market_momentum_sp500", "Market momentum", "S&P 500 vs its 125-day moving average"),
    ("stock_price_strength", "Stock price strength", "Net new 52-week highs vs lows on the NYSE"),
    ("stock_price_breadth", "Stock price breadth", "McClellan volume summation index"),
    ("put_call_options", "Put and call options", "5-day average put/call ratio"),
    ("market_volatility_vix", "Market volatility", "VIX vs its 50-day moving average"),
    ("safe_haven_demand", "Safe haven demand", "Difference in 20-day stock and bond returns"),
    ("junk_bond_demand", "Junk bond demand", "Yield spread: junk bonds vs investment grade"),
]

_cache: dict = {"at": 0.0, "data": None}
_lock = threading.Lock()


def _day(ms: float) -> str:
    return dt.datetime.fromtimestamp(ms / 1000, tz=dt.timezone.utc).date().isoformat()


def parse(raw: dict) -> dict:
    fg = raw["fear_and_greed"]
    hist = raw.get("fear_and_greed_historical", {}).get("data", [])
    return {
        "score": fg["score"],
        "rating": fg["rating"],
        "timestamp": fg.get("timestamp"),
        "previous": [
            {"label": label, "score": fg.get(key)}
            for key, label in [("previous_close", "Previous close"), ("previous_1_week", "1 week ago"),
                               ("previous_1_month", "1 month ago"), ("previous_1_year", "1 year ago")]
            if fg.get(key) is not None
        ],
        "history": list({_day(p["x"]): {"date": _day(p["x"]), "score": round(p["y"], 2), "rating": p.get("rating")}
                         for p in hist}.values()),
        "indicators": [
            {"key": key, "label": label, "description": desc, "score": raw[key].get("score"), "rating": raw[key].get("rating")}
            for key, label, desc in INDICATORS if isinstance(raw.get(key), dict)
        ],
    }


def get() -> dict:
    with _lock:
        if _cache["data"] is not None and time.time() - _cache["at"] < TTL:
            return _cache["data"]
    req = urllib.request.Request(URL, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15, context=ssl.create_default_context(cafile=certifi.where())) as resp:
        data = parse(json.loads(resp.read()))
    with _lock:
        _cache["at"], _cache["data"] = time.time(), data
    return data
