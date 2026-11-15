FROM node:26-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY analysis-engine/package.json analysis-engine/package-lock.json ./
RUN npm ci --omit=dev
COPY analysis-engine/src ./src
USER node
EXPOSE 5000
CMD ["node", "--import", "./src/tracer.js", "src/server.js"]
