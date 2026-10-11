import os
import tempfile

os.environ["STONKSFOLIO_DATA_DIR"] = tempfile.mkdtemp()
os.environ["STONKSFOLIO_DISABLE_SCHEDULER"] = "1"

from app.main import guess_mapping, parse_csv  # noqa: E402


def test_parse_csv_formats():
    text = "Date;Type;Symbol;Quantity;Price;Fees;Currency\n01/02/2024;buy;aapl;10;1.234,50;2,5;USD\n\n2024-03-01;SELL;AAPL;-5;190.1;;\n"
    rows, errors = parse_csv(text)
    assert errors == []
    assert rows[0].symbol == "AAPL" and rows[0].type == "BUY" and rows[0].price == 1234.5 and rows[0].fees == 2.5
    assert rows[0].date.isoformat() == "2024-02-01"
    assert rows[1].quantity == 5 and rows[1].currency is None


def test_parse_csv_errors():
    rows, errors = parse_csv("date,type,symbol,quantity,price\n2024-01-01,FOO,X,1,1\n")
    assert rows == [] and "Row 2" in errors[0]
    _, errors = parse_csv("date,symbol\n")
    assert "Missing columns" in errors[0]


def test_parse_csv_mapping():
    text = "When,Ticker,What,Units,Cost,Extra\n2024-01-02,aapl,Buy,3,100,x\n"
    rows, errors = parse_csv(text, {"date": 0, "symbol": 1, "type": 2, "quantity": 3, "price": 4})
    assert errors == [] and rows[0].symbol == "AAPL" and rows[0].quantity == 3 and rows[0].fees == 0
    _, errors = parse_csv(text, {"date": 0, "symbol": 1, "type": 2, "quantity": 3})
    assert "Missing columns: price" in errors[0]
    _, errors = parse_csv(text, {"date": 0, "symbol": 1, "type": 2, "quantity": 3, "price": 9})
    assert "Invalid column" in errors[0]
    assert guess_mapping(["Trade Date", "Ticker", "Action", "Shares", "Price", "Commission"]) == {
        "date": 0, "type": 2, "symbol": 1, "quantity": 3, "price": 4, "fees": 5}


def test_parse_csv_exchange():
    text = ("date,symbol,exchange,type,quantity,price\n"
            "2024-01-02,ASML,AS,BUY,1,600\n2024-01-02,SAP,XETRA,BUY,1,150\n2024-01-02,AAPL,NASDAQ,BUY,1,180\n"
            "2024-01-02,BRK.B,NYSE,BUY,1,360\n2024-01-02,ULVR.L,LSE,BUY,1,40\n2024-01-02,VWCE.DE,,BUY,1,100\n")
    rows, errors = parse_csv(text)
    assert errors == []
    assert [r.symbol for r in rows] == ["ASML.AS", "SAP.DE", "AAPL", "BRK-B", "ULVR.L", "VWCE.DE"]
    _, errors = parse_csv("date,symbol,exchange,type,quantity,price\n2024-01-02,X,MOON,BUY,1,1\n")
    assert "unknown exchange 'MOON'" in errors[0]


def test_is_isin():
    from app.market_data import is_isin

    assert is_isin("US0378331005")  # Apple
    assert is_isin("IE00BK5BQT80")  # VWCE
    assert is_isin("nl0010273215")  # ASML, lower case
    assert not is_isin("US0378331006")  # bad check digit
    assert not is_isin("AAPL")
    assert not is_isin("ASML.AS")


def test_plausible_isin_secondary_listing():
    from app.market_data import _plausible_isin

    # Secondary listings (e.g. FRI.DE for FICO) often come without a country: accept a valid ISIN.
    assert _plausible_isin("US3032501047", {"quoteType": "EQUITY", "country": None})
    assert _plausible_isin("US3032501047", {"quoteType": "EQUITY", "country": "United States"})
    assert not _plausible_isin("US3032501047", {"quoteType": "EQUITY", "country": "Netherlands"})
    assert not _plausible_isin("US3032501046", {"quoteType": "EQUITY", "country": None})


def test_fx_factor_same_currency():
    from app.market_data import _fx_factor

    assert _fx_factor("EUR", "EUR") == 1.0
    assert _fx_factor("GBp", "GBP") == 0.01
    assert _fx_factor("GBP", "GBp") == 100.0
    assert _fx_factor(None, "EUR") is None


def test_insider_kind():
    from app.main import _insider_kind

    assert _insider_kind("Purchase at price 69.87 - 70.31 per share.") == "buy"
    assert _insider_kind("Sale at price 222.19 per share.") == "sell"
    assert _insider_kind("Stock Award(Grant) at price 0.00 per share.") == "award"
    assert _insider_kind("Stock Gift at price 0.00 per share.") == "gift"
    assert _insider_kind("Conversion of Exercise of derivative security at price 1 per share.") == "exercise"
    assert _insider_kind("") == "other"


def test_insider_summary():
    import datetime as dt

    from app.main import insider_summary

    today = dt.date(2026, 10, 1)
    tx = [
        {"date": "2026-09-01", "kind": "buy", "value": 100.0},
        {"date": "2026-08-01", "kind": "sell", "value": 300.0},
        {"date": "2026-07-01", "kind": "sell", "value": None},
        {"date": "2026-06-01", "kind": "award", "value": 999.0},
        {"date": "2026-01-01", "kind": "buy", "value": 5000.0},  # outside the 6-month window
    ]
    s = insider_summary({"currency": "USD", "transactions": tx}, today)
    assert (s["insider_buys"], s["insider_sells"], s["insider_net_trades"]) == (1, 2, -1)
    assert (s["insider_buy_value"], s["insider_sell_value"], s["insider_net_value"]) == (100.0, 300.0, -200.0)
    assert s["insider_currency"] == "USD"
    assert insider_summary({"currency": "EUR", "transactions": []})["insider_net_value"] is None  # no data != no trades
    assert insider_summary(None)["insider_net_trades"] is None


def test_sell_validation():
    import datetime as dt

    from app import positions as pos
    D = dt.date
    txs = [pos.Tx(1, D(2024, 1, 1), "BUY", "A", 5), pos.Tx(2, D(2024, 2, 1), "SELL", "A", 3)]
    assert pos.sell_errors(txs, {}) == []
    bad = pos.sell_errors(txs + [pos.Tx(3, D(2024, 3, 1), "SELL", "A", 7)], {})
    assert len(bad) == 1 and bad[0].tx_id == 3 and abs(bad[0].held - 2) < 1e-9
    # a sell dated before the buy is invalid; same-day buy+sell is fine
    assert pos.sell_errors([pos.Tx(1, D(2024, 1, 2), "BUY", "A", 5), pos.Tx(2, D(2024, 1, 1), "SELL", "A", 1)], {})
    assert not pos.sell_errors([pos.Tx(2, D(2024, 1, 1), "SELL", "A", 5), pos.Tx(1, D(2024, 1, 1), "BUY", "A", 5)], {})
    # max sellable respects later sells
    assert pos.max_sellable(txs, {}, "A", D(2024, 1, 15)) == 2
    assert pos.max_sellable(txs, {}, "A", D(2024, 3, 1)) == 2
    assert pos.max_sellable(txs, {}, "A", D(2023, 12, 1)) == 0
    # 2:1 split between buy and sell: 5 pre-split shares become 10
    splits = {"A": [(D(2024, 1, 15), 2.0)]}
    assert pos.max_sellable(txs[:1], splits, "A", D(2024, 2, 1)) == 10
    assert not pos.sell_errors(txs[:1] + [pos.Tx(3, D(2024, 2, 1), "SELL", "A", 10)], splits)
    assert pos.sell_errors(txs[:1] + [pos.Tx(3, D(2024, 2, 1), "SELL", "A", 11)], splits)
