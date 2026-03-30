# ─── Stage 1: Build Frontend ──────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ ./
RUN pnpm run build

# ─── Stage 2: Build Go Backend ────────────────────────────────────────────────
FROM golang:1.25-alpine AS backend-builder

WORKDIR /app/backend

RUN apk add --no-cache build-base

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
RUN CGO_ENABLED=1 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/copilot-manager ./cmd/server

# ─── Stage 3: Runtime ─────────────────────────────────────────────────────────
FROM alpine:3.21

WORKDIR /app

RUN apk add --no-cache ca-certificates tzdata

COPY --from=backend-builder /out/copilot-manager ./copilot-manager
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist/

VOLUME ["/app/data"]

EXPOSE 4242

ENV PORT=4242 \
    DATA_DIR=/app/data \
    NODE_ENV=production \
    GOMEMLIMIT=320MiB \
    GOGC=50 \
    MAX_PROXY_BODY_SIZE=16MiB \
    LOG_RETENTION_COUNT=2000 \
    CACHE_TTL_SECONDS=120

CMD ["./copilot-manager"]
