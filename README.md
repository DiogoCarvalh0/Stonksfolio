# Stonksfolio

Stonksfolio is a self-hosted portfolio tracker web app with the sole difference that everything is stored locally with a clean UI. The goal is to be able to track a portfolio holdings, dividends, growth, and the market mood without any external paid dependencies. In other words, it is an app made thinking about me for you :) 

<p align="center">
  <img src="/assets/Demo/Demo.gif?raw=true" width="100%" alt="Demo" />
</p>

## Quick Start

```bash
# Backend: install dependencies and start the API (default port: 8000)
cd backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --reload --port 8000
```

```bash
# Frontend: in a second terminal, install dependencies and start the dev server (default port: 5173)
cd frontend
npm install
npm run dev
```

Then open **http://localhost:5173** in your browser.

## Docker

```bash
# Build the image and run the container (maps port 8000 and persists your database in ./data)
docker compose up -d --build
```

Then open **http://localhost:8000** (or replace `localhost` with your NAS/server IP).

Prices are refreshed automatically at the hours set in `STONKSFOLIO_REFRESH_HOURS` (default `7,23`, local time from `TZ`). On a NAS, set `PUID`/`PGID` in `docker-compose.yml` to the user that should own `./data`.
