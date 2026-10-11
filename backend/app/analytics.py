"""Portfolio analytics: positions, daily value series, TWR, XIRR, dividends, allocation.

Conventions
- Yahoo closes are split-adjusted (not dividend-adjusted). Transactions are converted to the
  current split basis (qty * future split factor, price / factor) so they line up with closes.
- Prices are kept in the security's *quoted* unit (e.g. GBp). `fx[cur]` is EUR per quoted unit.
- Trades and dividends are cash flows at the end of the day (see TWR in `_prepare`).
"""
from __future__ import annotations

import datetime as dt
import json
import math
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Dict, List, Optional

import numpy as np
import pandas as pd

from .market_data import BASE_CURRENCY, normalize_currency

EPS = 1e-9


@dataclass
class SecurityMeta:
    symbol: str
    name: str
    currency: str  # quoted currency, e.g. "USD" or "GBp"
    quote_type: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    country: Optional[str] = None
    exchange: Optional[str] = None
    sector_weights: Optional[Dict[str, float]] = None
    info: dict = field(default_factory=dict)


@dataclass
class TxIn:
    id: int
    date: dt.date
    type: str
    symbol: str
    quantity: float
    price: float
    fees: float
    currency: str


@dataclass
class PortfolioInput:
    transactions: List[TxIn]
    securities: Dict[str, SecurityMeta]
    prices: Dict[str, pd.Series]  # symbol -> close series (DatetimeIndex), incl. FX symbols "EURUSD=X"
    dividends: Dict[str, pd.Series]
    splits: Dict[str, pd.Series]
    benchmark: Optional[str] = None
    dividend_tax_rate: float = 0.0  # percent
    today: Optional[dt.date] = None


# ---------------------------------------------------------------- helpers

def xirr(dates: List[dt.date], amounts: List[float]) -> Optional[float]:
    if len(amounts) < 2 or not any(a > 0 for a in amounts) or not any(a < 0 for a in amounts):
        return None
    d0 = min(dates)
    years = np.array([(d - d0).days / 365.0 for d in dates])
    amts = np.array(amounts)
    if years.max() < 1 / 365:
        return None

    def npv(rate):
        return float(np.sum(amts / np.power(1.0 + rate, years)))

    lo, hi = -0.9999, 100.0
    f_lo, f_hi = npv(lo), npv(hi)
    if math.isnan(f_lo) or math.isnan(f_hi) or f_lo * f_hi > 0:
        return None
    for _ in range(200):
        mid = (lo + hi) / 2
        f_mid = npv(mid)
        if abs(f_mid) < 1e-7:
            break
        if f_lo * f_mid < 0:
            hi = mid
        else:
            lo, f_lo = mid, f_mid
    return (lo + hi) / 2


def _series(s: Optional[pd.Series]) -> pd.Series:
    if s is None or len(s) == 0:
        return pd.Series(dtype=float, index=pd.DatetimeIndex([]))
    s = s.copy()
    s.index = pd.to_datetime(s.index).normalize()
    s = s[~s.index.duplicated(keep="last")].sort_index()
    return s.astype(float)


def _on_dates(s: pd.Series, dates: pd.DatetimeIndex) -> pd.Series:
    if s.empty:
        return pd.Series(np.nan, index=dates)
    out = s.reindex(s.index.union(dates)).ffill().reindex(dates)
    return out.bfill()


def _f(x, nd=2):
    if x is None:
        return None
    try:
        if math.isnan(x) or math.isinf(x):
            return None
    except TypeError:
        return x
    return round(float(x), nd)


ASSET_TYPE_NAMES = {"EQUITY": "Stocks", "ETF": "ETFs", "MUTUALFUND": "Funds", "INDEX": "Index"}


# ---------------------------------------------------------------- engine

class Portfolio:
    def __init__(self, data: PortfolioInput):
        self.data = data
        self.today = pd.Timestamp(data.today or dt.date.today())
        self.warnings: List[str] = []
        self.tax = max(0.0, min(100.0, data.dividend_tax_rate)) / 100.0
        self._fx_cache: Dict[str, pd.Series] = {}
        txs = sorted(data.transactions, key=lambda t: (t.date, 0 if t.type == "BUY" else 1, t.id))
        self.txs = txs
        if txs:
            start = pd.Timestamp(min(t.date for t in txs))
            end = max(self.today, pd.Timestamp(max(t.date for t in txs)))
            self.dates = pd.date_range(start, end, freq="D")
        else:
            self.dates = pd.DatetimeIndex([self.today])
        self.symbols = sorted({t.symbol for t in txs if t.type in ("BUY", "SELL")})
        self._prepare()

    # -- fx -----------------------------------------------------------
    def fx(self, currency: Optional[str]) -> pd.Series:
        """EUR per 1 quoted unit of `currency`, on self.dates."""
        currency = currency or BASE_CURRENCY
        if currency in self._fx_cache:
            return self._fx_cache[currency]
        major, mult = normalize_currency(currency)
        if major == BASE_CURRENCY:
            s = pd.Series(mult, index=self.dates)
        else:
            raw = _series(self.data.prices.get(f"{BASE_CURRENCY}{major}=X"))
            if raw.empty:
                self.warnings.append(f"Missing FX rates for {major}; treated as 1:1")
                s = pd.Series(mult, index=self.dates)
            else:
                s = mult / _on_dates(raw, self.dates)
        self._fx_cache[currency] = s
        return s

    def fx_at(self, currency: Optional[str], date) -> float:
        s = self.fx(currency)
        ts = pd.Timestamp(date)
        if ts in s.index:
            return float(s.loc[ts])
        return float(s.iloc[-1] if ts > s.index[-1] else s.iloc[0])

    def sec(self, symbol: str) -> SecurityMeta:
        m = self.data.securities.get(symbol)
        if m is None:
            m = SecurityMeta(symbol=symbol, name=symbol, currency=BASE_CURRENCY)
            self.data.securities[symbol] = m
        return m

    def split_factor(self, symbol: str, date: dt.date) -> float:
        s = _series(self.data.splits.get(symbol))
        if s.empty:
            return 1.0
        after = s[s.index > pd.Timestamp(date)]
        return float(np.prod(after.values)) if len(after) else 1.0

    # -- core ----------------------------------------------------------
    def _prepare(self):
        dates = self.dates
        n = len(dates)
        pos = {d: i for i, d in enumerate(dates)}
        qty = pd.DataFrame(0.0, index=dates, columns=self.symbols)
        buys = np.zeros(n)
        sells = np.zeros(n)
        self.norm_txs = []
        manual_div_symbols = set()
        lots = {s: {"qty": 0.0, "cost_eur": 0.0, "cost_local": 0.0, "realized_eur": 0.0, "fees_eur": 0.0,
                    "bought_eur": 0.0, "sold_eur": 0.0, "first_date": None} for s in self.symbols}
        tx_price_points = defaultdict(dict)
        manual_divs = []

        for t in self.txs:
            meta = self.sec(t.symbol)
            fx_tx = self.fx_at(t.currency, t.date)
            fx_sec = self.fx_at(meta.currency, t.date)
            i = pos[pd.Timestamp(t.date)]
            if t.type == "DIVIDEND":
                manual_div_symbols.add(t.symbol)
                gross_local_tx = t.quantity * t.price
                manual_divs.append({
                    "date": t.date, "symbol": t.symbol, "shares": t.quantity, "per_share": t.price,
                    "currency": t.currency, "amount_local": gross_local_tx - t.fees,
                    "amount_eur": (gross_local_tx - t.fees) * fx_tx, "tax_eur": t.fees * fx_tx, "source": "manual",
                })
                continue
            f = self.split_factor(t.symbol, t.date)
            q = t.quantity * f
            price_tx = t.price / f
            price_local = price_tx * fx_tx / fx_sec if fx_sec else price_tx
            gross_eur = t.quantity * t.price * fx_tx
            fees_eur = t.fees * fx_tx
            lot = lots[t.symbol]
            lot["fees_eur"] += fees_eur
            tx_price_points[t.symbol][pd.Timestamp(t.date)] = price_local
            if t.type == "BUY":
                qty.iat[i, qty.columns.get_loc(t.symbol)] += q
                buys[i] += gross_eur + fees_eur
                lot["qty"] += q
                lot["cost_eur"] += gross_eur + fees_eur
                lot["cost_local"] += q * price_local + (fees_eur / fx_sec if fx_sec else 0)
                lot["bought_eur"] += gross_eur + fees_eur
                lot["first_date"] = lot["first_date"] or t.date
            elif t.type == "SELL":
                if q > lot["qty"] + 1e-6:
                    self.warnings.append(f"{t.symbol}: sell on {t.date} exceeds held quantity")
                q_eff = min(q, lot["qty"]) if lot["qty"] > 0 else 0.0
                avg_eur = lot["cost_eur"] / lot["qty"] if lot["qty"] > EPS else 0
                avg_local = lot["cost_local"] / lot["qty"] if lot["qty"] > EPS else 0
                proceeds = gross_eur - fees_eur
                qty.iat[i, qty.columns.get_loc(t.symbol)] -= q_eff
                sells[i] += proceeds
                lot["realized_eur"] += proceeds - avg_eur * q_eff
                lot["cost_eur"] -= avg_eur * q_eff
                lot["cost_local"] -= avg_local * q_eff
                lot["qty"] -= q_eff
                lot["sold_eur"] += proceeds
                if lot["qty"] < 1e-8:
                    lot.update(qty=0.0, cost_eur=0.0, cost_local=0.0)
            self.norm_txs.append({"id": t.id, "date": t.date, "symbol": t.symbol, "type": t.type, "qty_adj": q,
                                  "amount_eur": gross_eur, "fees_eur": fees_eur})

        qty = qty.cumsum().clip(lower=0)
        self.qty = qty
        self.lots = lots

        # prices (quoted units) and EUR values
        price_df = pd.DataFrame(index=dates, columns=self.symbols, dtype=float)
        fx_df = pd.DataFrame(index=dates, columns=self.symbols, dtype=float)
        self.raw_closes: Dict[str, pd.Series] = {}
        for s in self.symbols:
            closes = _series(self.data.prices.get(s))
            self.raw_closes[s] = closes
            pts = pd.Series(tx_price_points[s]).sort_index() if tx_price_points[s] else pd.Series(dtype=float)
            combined = closes.combine_first(pts) if not closes.empty else pts
            if closes.empty:
                self.warnings.append(f"No price history for {s}; using transaction prices")
            price_df[s] = _on_dates(combined, dates)
            fx_df[s] = self.fx(self.sec(s).currency).values
        self.price_df = price_df
        self.fx_df = fx_df
        values = (qty * price_df * fx_df).fillna(0.0)
        self.values_by_symbol = values
        value = values.sum(axis=1).values if self.symbols else np.zeros(n)

        # dividends
        div_records = list(manual_divs)
        for s in self.symbols:
            if s in manual_div_symbols:
                continue
            ev = _series(self.data.dividends.get(s))
            meta = self.sec(s)
            for d, amt in ev.items():
                if d > self.today or d <= dates[0]:
                    continue
                prev = d - pd.Timedelta(days=1)
                shares = float(qty[s].loc[prev]) if prev in qty.index else 0.0
                if shares <= EPS:
                    continue
                gross_local = shares * amt
                fxv = self.fx_at(meta.currency, d)
                div_records.append({
                    "date": d.date(), "symbol": s, "shares": shares, "per_share": float(amt),
                    "currency": meta.currency, "amount_local": gross_local * (1 - self.tax),
                    "amount_eur": gross_local * fxv * (1 - self.tax), "tax_eur": gross_local * fxv * self.tax,
                    "source": "auto",
                })
        div_records.sort(key=lambda r: r["date"])
        self.div_records = div_records
        divs = np.zeros(n)
        for r in div_records:
            ts = pd.Timestamp(r["date"])
            if ts in pos:
                divs[pos[ts]] += r["amount_eur"]

        # TWR: flows at end of day (trades are entered near the close). When a buy dwarfs the
        # existing portfolio, fall back to Modified Dietz to avoid blow-ups from intraday prices.
        prev_v = np.concatenate([[0.0], value[:-1]])
        gain = value + sells + divs - buys - prev_v
        denom = np.where(prev_v <= EPS, buys, np.where(buys > 5 * prev_v, prev_v + 0.5 * buys, prev_v))
        with np.errstate(divide="ignore", invalid="ignore"):
            r = np.where(denom > EPS, gain / denom, 0.0)
        r = np.nan_to_num(r)
        self.daily_returns = r
        self.twr_index = np.cumprod(1.0 + r)
        self.value = value
        self.buys = buys
        self.sells = sells
        self.divs = divs
        self.net_invested = np.cumsum(buys - sells)

    # ---------------------------------------------------------------- outputs
    def price_index(self, closes: Optional[pd.Series], currency: Optional[str]) -> Optional[np.ndarray]:
        """EUR price series of any security on self.dates, rebased to 1.0 on the first date."""
        closes = _series(closes)
        if closes.empty:
            return None
        series = (_on_dates(closes, self.dates) * self.fx(currency or BASE_CURRENCY)).values
        base = series[0]
        if not base or math.isnan(base):
            return None
        return series / base

    def benchmark_index(self) -> Optional[np.ndarray]:
        b = self.data.benchmark
        if not b:
            return None
        meta = self.data.securities.get(b)
        return self.price_index(self.data.prices.get(b), meta.currency if meta else BASE_CURRENCY)

    def performance(self) -> dict:
        bench = self.benchmark_index()
        cum_div = np.cumsum(self.divs)
        out = []
        for i, d in enumerate(self.dates):
            out.append({
                "date": d.date().isoformat(),
                "value": _f(self.value[i]),
                "invested": _f(self.net_invested[i]),
                "dividends": _f(cum_div[i]),
                "profit": _f(self.value[i] - self.net_invested[i] + cum_div[i]),
                "twr": _f(self.twr_index[i], 6),
                "benchmark": _f(bench[i], 6) if bench is not None else None,
            })
        return {"benchmark": self.data.benchmark, "series": out if self.txs else []}

    def _last_two_closes(self, s: str):
        c = self.raw_closes.get(s)
        if c is None or c.empty:
            return None, None
        c = c[c.index <= self.today]
        if len(c) == 0:
            return None, None
        return float(c.iloc[-1]), (float(c.iloc[-2]) if len(c) > 1 else None)

    def ttm_dividend(self, s: str) -> float:
        ev = _series(self.data.dividends.get(s))
        if ev.empty:
            return 0.0
        return float(ev[(ev.index > self.today - pd.Timedelta(days=365)) & (ev.index <= self.today)].sum())

    def holdings(self, include_closed: bool = False) -> List[dict]:
        last = self.dates[-1]
        total_value = float(self.value[-1]) if len(self.value) else 0.0
        div_by_symbol = defaultdict(float)
        flows = defaultdict(list)
        for r in self.div_records:
            div_by_symbol[r["symbol"]] += r["amount_eur"]
            flows[r["symbol"]].append((r["date"], r["amount_eur"]))
        for t in self.norm_txs:
            if t["type"] == "BUY":
                flows[t["symbol"]].append((t["date"], -(t["amount_eur"] + t["fees_eur"])))
            elif t["type"] == "SELL":
                flows[t["symbol"]].append((t["date"], t["amount_eur"] - t["fees_eur"]))
        rows = []
        for s in self.symbols:
            lot = self.lots[s]
            meta = self.sec(s)
            q = lot["qty"]
            if q <= EPS and not include_closed:
                continue
            price = float(self.price_df[s].loc[last]) if not math.isnan(self.price_df[s].loc[last]) else None
            fx_now = float(self.fx_df[s].loc[last])
            value = q * price * fx_now if price is not None else 0.0
            last_close, prev_close = self._last_two_closes(s)
            day_pct = (last_close / prev_close - 1) if last_close and prev_close else None
            day_eur = q * (last_close - prev_close) * fx_now if day_pct is not None else 0.0
            unreal = value - lot["cost_eur"] if q > EPS else 0.0
            ttm = self.ttm_dividend(s)
            avg_local = lot["cost_local"] / q if q > EPS else None
            total_profit = unreal + lot["realized_eur"] + div_by_symbol[s]
            fl = sorted(flows[s]) + ([(last.date(), value)] if value > EPS else [])
            irr = xirr([d for d, _ in fl], [a for _, a in fl]) if len(fl) > 1 else None
            rows.append({
                "symbol": s, "name": meta.name, "currency": meta.currency, "quote_type": meta.quote_type,
                "asset_type": ASSET_TYPE_NAMES.get(meta.quote_type or "", meta.quote_type or "Other"),
                "sector": meta.sector, "country": meta.country, "exchange": meta.exchange,
                "quantity": _f(q, 6), "avg_price": _f(avg_local, 4), "price": _f(price, 4),
                "fx": _f(fx_now, 8), "cost_local": _f(lot["cost_local"]),
                "value": _f(value), "cost": _f(lot["cost_eur"]), "weight": _f(value / total_value * 100 if total_value else 0, 2),
                "unrealized": _f(unreal), "unrealized_pct": _f(unreal / lot["cost_eur"] * 100 if lot["cost_eur"] > EPS else None),
                "realized": _f(lot["realized_eur"]), "dividends": _f(div_by_symbol[s]), "fees": _f(lot["fees_eur"]),
                "total_profit": _f(total_profit),
                "total_profit_pct": _f(total_profit / lot["bought_eur"] * 100 if lot["bought_eur"] > EPS else None),
                "day_change": _f(day_eur), "day_change_pct": _f(day_pct * 100 if day_pct is not None else None),
                "dividend_yield": _f(ttm / price * 100 if price and ttm else 0),
                "yield_on_cost": _f(ttm * q / lot["cost_local"] * 100 if lot["cost_local"] > EPS and ttm else 0),
                "annual_income": _f(ttm * q * fx_now * (1 - self.tax)),
                "first_buy": lot["first_date"].isoformat() if lot["first_date"] else None,
                "closed": q <= EPS,
                "irr": _f(irr * 100 if irr is not None else None),
            })
        rows.sort(key=lambda r: -(r["value"] or 0))
        return rows

    def summary(self) -> dict:
        h = self.holdings(include_closed=True)
        value = sum(r["value"] or 0 for r in h)
        cost = sum(r["cost"] or 0 for r in h if not r["closed"])
        unreal = sum(r["unrealized"] or 0 for r in h)
        realized = sum(r["realized"] or 0 for r in h)
        dividends = sum(r["amount_eur"] for r in self.div_records)
        fees = sum(r["fees"] or 0 for r in h)
        day = sum(r["day_change"] or 0 for r in h if not r["closed"])
        profit = unreal + realized + dividends
        flows_d, flows_a = [], []
        for i, d in enumerate(self.dates):
            amt = -self.buys[i] + self.sells[i] + self.divs[i]
            if abs(amt) > EPS:
                flows_d.append(d.date())
                flows_a.append(amt)
        if value > EPS:
            flows_d.append(self.dates[-1].date())
            flows_a.append(value)
        irr = xirr(flows_d, flows_a) if self.txs else None
        twr = float(self.twr_index[-1] - 1) if self.txs else 0.0
        bench = self.benchmark_index()
        annual_income = sum(r["annual_income"] or 0 for r in h if not r["closed"])
        return {
            "currency": BASE_CURRENCY,
            "value": _f(value), "cost": _f(cost), "unrealized": _f(unreal),
            "unrealized_pct": _f(unreal / cost * 100 if cost > EPS else None),
            "realized": _f(realized), "dividends": _f(dividends), "fees": _f(fees),
            "total_profit": _f(profit), "total_profit_pct": _f(profit / cost * 100 if cost > EPS else None),
            "day_change": _f(day), "day_change_pct": _f(day / (value - day) * 100 if value - day > EPS else None),
            "twr": _f(twr * 100), "xirr": _f(irr * 100 if irr is not None else None),
            "benchmark": self.data.benchmark,
            "benchmark_return": _f((bench[-1] - 1) * 100 if bench is not None else None),
            "annual_income": _f(annual_income),
            "portfolio_yield": _f(annual_income / value * 100 if value > EPS else None),
            "holdings_count": sum(1 for r in h if not r["closed"]),
            "first_date": self.dates[0].date().isoformat() if self.txs else None,
            "warnings": sorted(set(self.warnings)),
        }

    def allocation(self) -> dict:
        h = [r for r in self.holdings() if (r["value"] or 0) > 0]
        total = sum(r["value"] for r in h) or 1.0
        groups = {k: defaultdict(float) for k in ("holding", "asset_type", "sector", "country", "currency")}
        for r in h:
            meta = self.sec(r["symbol"])
            v = r["value"]
            groups["holding"][r["symbol"]] += v
            groups["asset_type"][r["asset_type"]] += v
            groups["currency"][normalize_currency(meta.currency)[0]] += v
            is_fund = meta.quote_type in ("ETF", "MUTUALFUND")
            groups["country"][meta.country or ("Diversified (fund)" if is_fund else "Unknown")] += v
            if meta.sector:
                groups["sector"][meta.sector] += v
            elif is_fund and meta.sector_weights:
                w = meta.sector_weights
                tot = sum(w.values())
                for k, wv in w.items():
                    groups["sector"][k] += v * wv / max(tot, 1.0)
                if tot < 1.0:
                    groups["sector"]["Other"] += v * (1.0 - tot)
            else:
                groups["sector"]["Unclassified fund" if is_fund else "Unknown"] += v
        out = {}
        names = {r["symbol"]: r["name"] for r in h}
        for k, g in groups.items():
            items = [{"key": key, "label": names.get(key, key) if k == "holding" else key,
                      "value": _f(v), "pct": _f(v / total * 100)} for key, v in g.items()]
            out[k] = sorted(items, key=lambda x: -x["value"])
        out["total"] = _f(total)
        return out

    def dividends(self) -> dict:
        received = [{**r, "date": r["date"].isoformat(), "amount_eur": _f(r["amount_eur"]),
                     "amount_local": _f(r["amount_local"], 4), "tax_eur": _f(r["tax_eur"]),
                     "shares": _f(r["shares"], 6), "per_share": _f(r["per_share"], 6),
                     "name": self.sec(r["symbol"]).name} for r in self.div_records]
        by_month = defaultdict(float)
        by_year = defaultdict(float)
        for r in self.div_records:
            by_month[r["date"].strftime("%Y-%m")] += r["amount_eur"]
            by_year[str(r["date"].year)] += r["amount_eur"]

        # Projection: repeat last-12-month payouts one year later; confirmed ex-dates override.
        upcoming = []
        today = self.today
        horizon = today + pd.Timedelta(days=365)
        for row in self.holdings():
            s = row["symbol"]
            meta = self.sec(s)
            q = self.lots[s]["qty"]
            fx_now = float(self.fx_df[s].iloc[-1])
            ev = _series(self.data.dividends.get(s))
            recent = ev[(ev.index > today - pd.Timedelta(days=365)) & (ev.index <= today)]
            projected = []
            for d, amt in recent.items():
                nd = d + pd.DateOffset(years=1)
                if today < nd <= horizon:
                    projected.append([nd, float(amt), False])
            cal = (meta.info or {}).get("calendar") or {}
            ex = cal.get("Ex-Dividend Date")
            if ex and recent.size:
                exd = pd.Timestamp(ex)
                if today < exd <= horizon:
                    near = [p for p in projected if abs((p[0] - exd).days) <= 45]
                    if near:
                        near[0][0], near[0][2] = exd, True
                    else:
                        projected.append([exd, float(recent.iloc[-1]), True])
            for d, amt, confirmed in projected:
                upcoming.append({
                    "date": d.date().isoformat(), "symbol": s, "name": meta.name, "per_share": _f(amt, 6),
                    "currency": meta.currency, "shares": _f(q, 6),
                    "amount_eur": _f(q * amt * fx_now * (1 - self.tax)), "confirmed": confirmed,
                })
        upcoming.sort(key=lambda x: x["date"])
        proj_month = defaultdict(float)
        for u in upcoming:
            proj_month[u["date"][:7]] += u["amount_eur"] or 0
        growth = []
        for row in self.holdings():
            g = self.dividend_growth(row["symbol"])
            if g:
                growth.append({"symbol": row["symbol"], "name": row["name"], "annual_income": row["annual_income"], **g})
        ttm_received = sum(r["amount_eur"] for r in self.div_records
                           if pd.Timestamp(r["date"]) > today - pd.Timedelta(days=365))
        return {
            "received": list(reversed(received)),
            "by_month": [{"month": k, "amount": _f(v)} for k, v in sorted(by_month.items())],
            "by_year": [{"year": k, "amount": _f(v)} for k, v in sorted(by_year.items())],
            "upcoming": upcoming,
            "projected_by_month": [{"month": k, "amount": _f(v)} for k, v in sorted(proj_month.items())],
            "total": _f(sum(r["amount_eur"] for r in self.div_records)),
            "ttm": _f(ttm_received),
            "projected_annual": _f(sum(u["amount_eur"] or 0 for u in upcoming)),
            "tax_rate": self.tax * 100,
            "growth": growth,
        }

    def dividend_growth(self, symbol: str, max_years: int = 5) -> Optional[dict]:
        """Per-share dividend CAGR between full calendar years (up to `max_years`), plus last-year growth."""
        ev = _series(self.data.dividends.get(symbol))
        if ev.empty:
            return None
        prices = _series(self.data.prices.get(symbol))
        first = prices.index[0] if not prices.empty else ev.index[0]
        yearly = ev.groupby(ev.index.year).sum()
        if first.month > 1 or first.day > 15:
            yearly = yearly[yearly.index > first.year]
        last_full = self.today.year - 1
        yearly = yearly[yearly.index <= last_full]
        if last_full not in yearly.index or yearly.get(last_full, 0) <= 0:
            return None
        b = float(yearly[last_full])
        n = next((k for k in range(max_years, 0, -1) if float(yearly.get(last_full - k, 0)) > 0), None)
        if n is None:
            return None
        prev = float(yearly.get(last_full - 1, 0))
        return {
            "cagr": _f(((b / float(yearly[last_full - n])) ** (1 / n) - 1) * 100),
            "years": n,
            "last_year": _f((b / prev - 1) * 100 if prev > 0 else None),
        }


def meta_from_row(sec) -> SecurityMeta:
    info = json.loads(sec.info_json) if sec.info_json else {}
    weights = json.loads(sec.sector_weights_json) if sec.sector_weights_json else None
    return SecurityMeta(symbol=sec.symbol, name=sec.name or sec.symbol, currency=sec.currency or BASE_CURRENCY,
                        quote_type=sec.quote_type, sector=sec.sector, industry=sec.industry, country=sec.country,
                        exchange=sec.exchange, sector_weights=weights, info=info)
