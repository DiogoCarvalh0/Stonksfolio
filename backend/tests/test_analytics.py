import datetime as dt

import pandas as pd
import pytest

from app.analytics import Portfolio, PortfolioInput, SecurityMeta, TxIn, xirr

D = dt.date


def series(points):
    return pd.Series({pd.Timestamp(k): v for k, v in points.items()}, dtype=float)


def make(txs, prices, securities=None, dividends=None, splits=None, today=D(2024, 1, 10), **kw):
    secs = securities or {s: SecurityMeta(symbol=s, name=s, currency="EUR") for s in {t.symbol for t in txs}}
    return Portfolio(PortfolioInput(transactions=txs, securities=secs, prices=prices, dividends=dividends or {},
                                    splits=splits or {}, today=today, **kw))


def tx(i, date, typ, sym, q, p, fees=0.0, cur="EUR"):
    return TxIn(id=i, date=date, type=typ, symbol=sym, quantity=q, price=p, fees=fees, currency=cur)


def test_simple_gain_and_twr():
    p = make([tx(1, D(2024, 1, 1), "BUY", "A", 10, 100)],
             {"A": series({"2024-01-01": 100, "2024-01-05": 120})})
    s = p.summary()
    assert s["value"] == 1200
    assert s["unrealized"] == 200
    assert s["twr"] == pytest.approx(20.0)


def test_twr_ignores_cash_flow_timing():
    txs = [tx(1, D(2024, 1, 1), "BUY", "A", 1, 100), tx(2, D(2024, 1, 2), "BUY", "A", 4, 110)]
    p = make(txs, {"A": series({"2024-01-01": 100, "2024-01-02": 110, "2024-01-03": 121})})
    s = p.summary()
    assert s["twr"] == pytest.approx(21.0, abs=1e-6)
    assert s["value"] == pytest.approx(605)
    assert s["cost"] == pytest.approx(540)


def test_split_adjustment():
    # bought 10 @ 400 before a 4:1 split; Yahoo closes are split-adjusted (100 pre-split)
    p = make([tx(1, D(2024, 1, 1), "BUY", "A", 10, 400)],
             {"A": series({"2024-01-01": 100, "2024-01-05": 110})},
             splits={"A": series({"2024-01-04": 4.0})})
    h = p.holdings()[0]
    assert h["quantity"] == 40
    assert h["avg_price"] == 100
    assert h["value"] == 4400
    assert p.summary()["twr"] == pytest.approx(10.0)


def test_fx_conversion_usd_stock():
    secs = {"U": SecurityMeta(symbol="U", name="U", currency="USD")}
    prices = {"U": series({"2024-01-01": 100, "2024-01-05": 100}),
              "EURUSD=X": series({"2024-01-01": 1.25, "2024-01-05": 1.0})}
    p = make([tx(1, D(2024, 1, 1), "BUY", "U", 10, 100, cur="USD")], prices, securities=secs)
    h = p.holdings()[0]
    assert h["cost"] == pytest.approx(800)  # 1000 USD / 1.25
    assert h["value"] == pytest.approx(1000)  # 1000 USD / 1.0
    assert h["avg_price"] == pytest.approx(100)  # in USD


def test_gbp_pence():
    secs = {"L": SecurityMeta(symbol="L", name="L", currency="GBp")}
    prices = {"L": series({"2024-01-01": 500}), "EURGBP=X": series({"2024-01-01": 0.8})}
    p = make([tx(1, D(2024, 1, 1), "BUY", "L", 100, 500, cur="GBp")], prices, securities=secs)
    assert p.holdings()[0]["value"] == pytest.approx(625)  # 100*5 GBP / 0.8


def test_partial_sell_average_cost():
    txs = [tx(1, D(2024, 1, 1), "BUY", "A", 10, 100), tx(2, D(2024, 1, 2), "BUY", "A", 10, 200),
           tx(3, D(2024, 1, 3), "SELL", "A", 5, 300, fees=10)]
    p = make(txs, {"A": series({"2024-01-01": 100, "2024-01-02": 200, "2024-01-03": 300})})
    h = p.holdings()[0]
    assert h["quantity"] == 15
    assert h["realized"] == pytest.approx(5 * 300 - 10 - 5 * 150)
    assert h["cost"] == pytest.approx(15 * 150)


def test_auto_dividends_and_tax():
    txs = [tx(1, D(2024, 1, 1), "BUY", "A", 10, 100), tx(2, D(2024, 1, 6), "BUY", "A", 10, 100)]
    p = make(txs, {"A": series({"2024-01-01": 100})}, dividends={"A": series({"2024-01-05": 1.0, "2024-01-07": 2.0})},
             dividend_tax_rate=15)
    d = p.dividends()
    amounts = sorted(r["amount_eur"] for r in d["received"])
    assert amounts == [pytest.approx(8.5), pytest.approx(34.0)]
    # dividends paid out count as return
    assert p.summary()["twr"] == pytest.approx((1.0085 * (2000 + 34) / 2000 - 1) * 100, abs=0.01)


def test_manual_dividends_override_auto():
    txs = [tx(1, D(2024, 1, 1), "BUY", "A", 10, 100), tx(2, D(2024, 1, 6), "DIVIDEND", "A", 10, 1.0, fees=1.5)]
    p = make(txs, {"A": series({"2024-01-01": 100})}, dividends={"A": series({"2024-01-05": 1.0})})
    rec = p.dividends()["received"]
    assert len(rec) == 1 and rec[0]["amount_eur"] == 8.5 and rec[0]["source"] == "manual"


def test_full_sell_closes_position():
    txs = [tx(1, D(2024, 1, 1), "BUY", "A", 10, 100), tx(2, D(2024, 1, 3), "SELL", "A", 10, 150)]
    p = make(txs, {"A": series({"2024-01-01": 100, "2024-01-03": 150, "2024-01-05": 50})})
    assert p.holdings() == []
    s = p.summary()
    assert s["value"] == 0 and s["realized"] == 500
    assert s["twr"] == pytest.approx(50.0)


def test_xirr():
    assert xirr([D(2023, 1, 1), D(2024, 1, 1)], [-100, 110]) == pytest.approx(0.10, abs=1e-4)
    assert xirr([D(2023, 1, 1)], [-100]) is None


def test_allocation_fund_lookthrough():
    secs = {"E": SecurityMeta(symbol="E", name="ETF", currency="EUR", quote_type="ETF",
                              sector_weights={"Technology": 0.5, "Energy": 0.3}),
            "S": SecurityMeta(symbol="S", name="Stock", currency="EUR", quote_type="EQUITY", sector="Energy", country="Spain")}
    txs = [tx(1, D(2024, 1, 1), "BUY", "E", 10, 100), tx(2, D(2024, 1, 1), "BUY", "S", 10, 100)]
    p = make(txs, {"E": series({"2024-01-01": 100}), "S": series({"2024-01-01": 100})}, securities=secs)
    a = {x["key"]: x["value"] for x in p.allocation()["sector"]}
    assert a == {"Energy": 1300, "Technology": 500, "Other": 200}


def test_benchmark_index():
    p = make([tx(1, D(2024, 1, 1), "BUY", "A", 1, 100)],
             {"A": series({"2024-01-01": 100}), "B": series({"2024-01-01": 50, "2024-01-10": 55})},
             benchmark="B")
    p.data.securities["B"] = SecurityMeta(symbol="B", name="B", currency="EUR")
    assert p.summary()["benchmark_return"] == pytest.approx(10.0)


def test_dividends_with_no_events():
    p = make([tx(1, D(2024, 1, 1), "BUY", "A", 1, 100)], {"A": series({"2024-01-01": 100})})
    d = p.dividends()
    assert d["received"] == [] and d["upcoming"] == [] and d["ttm"] == 0
