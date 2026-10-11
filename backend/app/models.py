from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import Date, DateTime, Float, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .db import Base

TX_TYPES = ("BUY", "SELL", "DIVIDEND")


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date, index=True)
    type: Mapped[str] = mapped_column(String(16))
    symbol: Mapped[str] = mapped_column(String(32), index=True)
    quantity: Mapped[float] = mapped_column(Float)
    price: Mapped[float] = mapped_column(Float)
    fees: Mapped[float] = mapped_column(Float, default=0.0)
    currency: Mapped[str] = mapped_column(String(8))
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())


class Security(Base):
    __tablename__ = "securities"

    symbol: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    currency: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)
    quote_type: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    sector: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    industry: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    country: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    exchange: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    info_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sector_weights_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    info_updated_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime, nullable=True)
    history_updated_at: Mapped[Optional[dt.datetime]] = mapped_column(DateTime, nullable=True)
    history_start: Mapped[Optional[dt.date]] = mapped_column(Date, nullable=True)


class ApiCache(Base):
    """Cached JSON responses of slow upstream lookups, e.g. "financials:NVDA"."""

    __tablename__ = "api_cache"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    data_json: Mapped[str] = mapped_column(Text)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime)


class Price(Base):
    __tablename__ = "prices"

    symbol: Mapped[str] = mapped_column(String(32), primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    close: Mapped[float] = mapped_column(Float)


class DividendEvent(Base):
    __tablename__ = "dividend_events"

    symbol: Mapped[str] = mapped_column(String(32), primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    amount: Mapped[float] = mapped_column(Float)


class SplitEvent(Base):
    __tablename__ = "split_events"

    symbol: Mapped[str] = mapped_column(String(32), primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    ratio: Mapped[float] = mapped_column(Float)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)


class WatchlistItem(Base):
    __tablename__ = "watchlist"

    symbol: Mapped[str] = mapped_column(String(32), primary_key=True)
    added_at: Mapped[dt.datetime] = mapped_column(DateTime, server_default=func.now())
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
