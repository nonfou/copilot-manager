# ─── Stage 1: Build Go Backend ────────────────────────────────────────────────
FROM golang:1.25-alpine AS backend-builder

WORKDIR /app/backend

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/copilot-manager ./cmd/server

# ─── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM alpine:3.21

WORKDIR /app

RUN apk add --no-cache ca-certificates tzdata

COPY --from=backend-builder /out/copilot-manager ./copilot-manager
COPY frontend/static ./frontend/static/

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
