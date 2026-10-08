# PrintDock als Home-Assistant-Add-on
# Wird von der GitHub-Action für amd64, aarch64 und armv7 gebaut (BUILD_FROM je Architektur).
# Lokal bauen: vorher "npm run ha-addon" ausführen (füllt ha-addon/app).
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM ${BUILD_FROM}
RUN apk add --no-cache nodejs npm ffmpeg tzdata
WORKDIR /app
COPY app/ /app/
RUN npm ci --omit=dev && npm cache clean --force
ENV NODE_ENV=production DATA_DIR=/data PORT=3080
LABEL io.hass.type="addon" io.hass.name="PrintDock"
CMD ["node", "server.js"]
