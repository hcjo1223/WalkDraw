FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
VOLUME ["/data"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
