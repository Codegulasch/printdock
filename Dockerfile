# PrintDock – Docker-Image für NAS, Raspberry Pi und Server
# Läuft auf amd64, arm64 (Pi 4/5, aktuelle NAS) und armv7 (Pi 2/3 mit 32-Bit-System).
FROM node:22-alpine

# ffmpeg für RTSP-Kameras (Bambu X1, H2D, X2D), tzdata für die Uhrzeit in Meldungen
RUN apk add --no-cache ffmpeg tzdata

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js camera.js notify.js ./
COPY drivers ./drivers
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production PORT=3080 DATA_DIR=/data
VOLUME /data
EXPOSE 3080

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3080)+'/api/app').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
