FROM node:22-alpine

ENV NODE_ENV=production

WORKDIR /srv

COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

# Usuario sin privilegios: la API solo necesita leer /data/results.
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /srv
USER app

EXPOSE 8000

CMD ["node", "src/server.js"]