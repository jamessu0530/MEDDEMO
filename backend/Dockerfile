# 建置時的 context 是 repo 根目錄：映像檔裡要一起放 data/seed，才能在 VM 上灌假資料
#   docker build -f backend/Dockerfile .
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:0.11.16 /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /srv/backend

# 先只放依賴清單，程式碼有改動時這一層可以沿用快取，不必重裝套件
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY backend/ ./
COPY data/seed/ /srv/data/seed/
COPY data/documents/ /srv/data/documents/
RUN uv sync --locked --no-dev

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
