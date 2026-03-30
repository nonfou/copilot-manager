# ─── Stage 1: Build Frontend ──────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ ./
RUN pnpm run build

# ─── Stage 2: Build Go Backend ────────────────────────────────────────────────
FROM golang:1.25-alpine AS go-builder

RUN apk add --no-cache gcc musl-dev

WORKDIR /app/backend

COPY backend/go.mod backend/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY backend/ ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=1 GOOS=linux go build -ldflags="-s -w -linkmode external -extldflags '-static'" -o /app/copilot-manager ./cmd/server/

# ─── Stage 3: Runtime ─────────────────────────────────────────────────────────
FROM alpine:3.21

WORKDIR /app

# CA certs for outbound HTTPS; tzdata for correct time zone
RUN apk add --no-cache ca-certificates tzdata

COPY --from=go-builder /app/copilot-manager ./
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist/

VOLUME ["/app/data"]

EXPOSE 4242

CMD ["./copilot-manager"]
