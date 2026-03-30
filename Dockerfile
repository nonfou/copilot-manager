# ─── Stage 1: Build Frontend ──────────────────────────────────────────────────
FROM node:22-alpine AS frontend-builder

WORKDIR /app/frontend

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ ./
RUN pnpm run build

# ─── Stage 2: Build Java Backend ──────────────────────────────────────────────
FROM maven:3.9-eclipse-temurin-21-alpine AS java-builder

WORKDIR /app/backend-java

COPY backend-java/pom.xml ./
RUN mvn dependency:go-offline -q

COPY backend-java/src ./src
RUN mvn clean package -DskipTests -q

# ─── Stage 3: Runtime ─────────────────────────────────────────────────────────
FROM eclipse-temurin:21-jre-alpine

WORKDIR /app

RUN apk add --no-cache ca-certificates tzdata

COPY --from=java-builder /app/backend-java/target/copilot-manager.jar ./
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist/

VOLUME ["/app/data"]

EXPOSE 4242

ENV JAVA_OPTS="-Xmx512m -Xms128m"

CMD ["sh", "-c", "java $JAVA_OPTS -jar copilot-manager.jar"]
