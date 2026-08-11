# Campus Forge backend runtime image.
#
# Packages the host-built Spring Boot fat jar (see AGENTS.md: build with
# `mvn clean package -DskipTests` from backend/) plus the Forge card data
# (forge-engine/forge-gui/res). The forge-headless engine SNAPSHOT only exists
# in the local Maven repo, so the jar is deliberately built on the host rather
# than in-container.
#
# Build context = repo root (see docker-compose.yml). Config via env:
#   JWT_SECRET, JWT_EXPIRATION_MS, QR_SIGNING_SECRET,
#   SPRING_DATASOURCE_URL / SPRING_DATASOURCE_USERNAME / SPRING_DATASOURCE_PASSWORD
FROM eclipse-temurin:17-jre

LABEL org.opencontainers.image.title="Campus Forge Backend"
LABEL org.opencontainers.image.description="Spring Boot REST + WebSocket game service"
LABEL org.opencontainers.image.source="https://github.com/anomalyco/opencode"

WORKDIR /app

COPY backend/target/campusforge-backend-0.0.1-SNAPSHOT.jar /app/campusforge-backend.jar
COPY forge-engine/forge-gui/res /app/forge-res

EXPOSE 17172

ENTRYPOINT ["java", "-Dforge.res.dir=/app/forge-res", "-jar", "/app/campusforge-backend.jar"]
