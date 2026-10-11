from app.sentiment import parse


def test_parse_fear_and_greed():
    raw = {
        "fear_and_greed": {"score": 31.2, "rating": "fear", "timestamp": "2026-10-02T23:59:58+00:00",
                           "previous_close": 28.1, "previous_1_week": 36.9, "previous_1_month": None},
        "fear_and_greed_historical": {"data": [{"x": 1790985598000.0, "y": 31.17142, "rating": "fear"}]},
        "put_call_options": {"score": 33, "rating": "fear", "data": []},
    }
    d = parse(raw)
    assert d["score"] == 31.2 and d["rating"] == "fear"
    assert [p["label"] for p in d["previous"]] == ["Previous close", "1 week ago"]
    assert d["history"] == [{"date": "2026-10-02", "score": 31.17, "rating": "fear"}]
    assert [i["key"] for i in d["indicators"]] == ["put_call_options"]
