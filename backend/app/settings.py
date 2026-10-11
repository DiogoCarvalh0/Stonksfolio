from __future__ import annotations

import threading

from sqlalchemy.orm import Session

from .models import Setting

DEFAULTS = {
    "benchmark": "IWDA.AS",  # iShares Core MSCI World (EUR)
    "dividend_tax_rate": "0",  # % withheld from auto-calculated dividends
}

_version = 0
_lock = threading.Lock()


def bump_version() -> None:
    """Invalidate cached analytics (call after any data change)."""
    global _version
    with _lock:
        _version += 1


def data_version() -> int:
    return _version


def get_settings(db: Session) -> dict:
    out = dict(DEFAULTS)
    for s in db.query(Setting).all():
        out[s.key] = s.value
    return {"benchmark": out["benchmark"], "dividend_tax_rate": float(out["dividend_tax_rate"] or 0)}


def update_settings(db: Session, values: dict) -> dict:
    for key, val in values.items():
        if key not in DEFAULTS or val is None:
            continue
        row = db.get(Setting, key)
        if row is None:
            db.add(Setting(key=key, value=str(val)))
        else:
            row.value = str(val)
    db.commit()
    bump_version()
    return get_settings(db)
