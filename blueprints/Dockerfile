# PrintDock – Docker-Image für NAS, Raspberry Pi und Server
# Läuft auf amd64, arm64 (Pi 4/5, aktuelle NAS) und armv7 (Pi 2/3 mit 32-Bit-System).
FROM node:22-alpine

# ffmpeg für RTSP-Kameras (Bambu X1, H2D, X2D), tzdata für die Uhrzeit in Meldungen
# samba-client: Speicherort auf einer SMB-Freigabe (NAS) ohne Einhängen
RUN apk add --no-cache ffmpeg tzdata samba-client

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.js camera.js notify.js launcher.js ./
COPY drivers ./drivers
COPY lib ./lib
COPY public ./public
COPY dist ./dist
COPY blueprints ./blueprints
COPY helper ./helper

ENV NODE_ENV=production PORT=3080 DATA_DIR=/data PRINTDOCK_RESTART=exit
VOLUME /data
EXPOSE 3080

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3080)+'/api/app').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# launcher.js: startet eine in PrintDock installierte neuere Version aus /data/app, sonst die des Images
CMD ["node", "launcher.js"]
