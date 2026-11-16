# Auth handler as a plain Node server (AWS ECS/Fargate/App Runner, Fly, Railway, any Docker host).
# Build from this folder: docker build -t editlet-auth packages/editlet/auth
FROM node:26-slim
WORKDIR /app
COPY protocol.ts handler.ts server.ts ./
# ESM, so Node runs the .ts files as modules.
RUN echo '{ "type": "module" }' > package.json
# srvx turns the Web `fetch` handler into a Node HTTP server; Node 26 runs the .ts files directly.
RUN npm install --no-save --no-package-lock --omit=dev srvx@1.0.8 && npm cache clean --force
ENV NODE_ENV=production PORT=8787
EXPOSE 8787
USER node
CMD ["node_modules/.bin/srvx", "serve", "--prod", "--entry", "./server.ts"]
