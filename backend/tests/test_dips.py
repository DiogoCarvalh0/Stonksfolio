import pytest

from app.dips import dip_metrics, rsi, sma


def test_sma_and_short_history():
    assert sma([1, 2, 3], 2) == 2.5
    assert sma([1, 2], 3) is None
    m = dip_metrics([10.0] * 100)
    assert m["vs_sma50"] == 0 and m["vs_sma200"] is None and m["from_high"] == 0


def test_dip_metrics_below_average():
    closes = [100.0] * 199 + [80.0]
    m = dip_metrics(closes)
    assert m["sma200"] == pytest.approx(99.9)
    assert m["vs_sma200"] == pytest.approx(-19.92, abs=0.01)
    assert m["from_high"] == -20.0


def test_rsi_bounds():
    assert rsi(list(range(1, 30))) == 100.0
    assert rsi(list(range(30, 1, -1))) == 0.0
    assert rsi([1.0] * 5) is None
    assert dip_metrics([])["price"] is None
