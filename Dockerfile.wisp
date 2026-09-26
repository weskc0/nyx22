FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY wisp-server.js ./

USER node
EXPOSE 8080
CMD ["node", "wisp-server.js"]
