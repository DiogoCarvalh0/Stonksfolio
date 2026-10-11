# Stonksfolio — single container: FastAPI backend serving the built React frontend.

# ---- frontend build ----
FROM node:22-alpine AS frontend
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---- runtime ----
FROM python:3.11-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    STONKSFOLIO_DATA_DIR=/data \
    STONKSFOLIO_STATIC_DIR=/app/static \
    TZ=Europe/Amsterdam

RUN apt-get update && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /data

WORKDIR /app
COPY backend/requirements.txt .
RUN grep -vE '^(pytest|httpx)' requirements.txt > req.txt && pip install -r req.txt && rm req.txt requirements.txt
COPY backend/app ./app
COPY --from=frontend /src/dist ./static
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/

# Runs as PUID:PGID (default 1000:1000) after fixing /data ownership
VOLUME /data
EXPOSE 8000
HEALTHCHECK --interval=60s --timeout=5s --start-period=30s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/settings', timeout=4)" || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
