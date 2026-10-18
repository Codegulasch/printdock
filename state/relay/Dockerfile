# PrintDock Status-Server – im PrintDock-Ordner bauen:
#   docker build -f relay/Dockerfile -t printdock-relay .
FROM node:22-alpine
WORKDIR /relay
COPY relay/server.js ./server.js
COPY lib/statusrender.js ./render.js
ENV PORT=8080 DATA_DIR=/data
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/health >/dev/null || exit 1
CMD ["node", "server.js"]
