# syntax=docker/dockerfile:1.7
# Turncoat guard service.
#   docker build --build-context repo=.. -t turncoat-guard .      (run from guard/)
# or `docker compose up -d --build` with guard/docker-compose.yml.
# The `repo` context is only used to compile the contract ABI; nothing secret is copied into the image.

# ---- 1. compile the Turncoat ABI from ../contracts
FROM node:22-bookworm-slim AS abi
WORKDIR /repo
# Install only what compile.mjs needs, at the exact versions in the repo's lockfile.
COPY --from=repo package-lock.json /tmp/lock.json
RUN npm install --no-save --ignore-scripts --no-audit --no-fund $(node -e 'const p=require("/tmp/lock.json").packages; console.log(["solc","@openzeppelin/contracts"].map((n)=>n+"@"+p["node_modules/"+n].version).join(" "))')
COPY --from=repo contracts ./contracts
COPY --from=repo scripts/compile.mjs ./scripts/compile.mjs
RUN node scripts/compile.mjs

# ---- 2. production dependencies of the guard service
FROM node:22-bookworm-slim AS deps
# Toolchain for better-sqlite3 when no prebuilt binary matches; stays in this stage only.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app/guard
COPY package.json package-lock.json ./
# --force only skips npm's platform check: the dev-only ganache bundles macOS fsevents, which is
# never installed here because dev dependencies are omitted.
RUN npm ci --omit=dev --force --no-audit --no-fund && test ! -d node_modules/ganache

# ---- 3. runtime
FROM node:22-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
WORKDIR /app/guard
COPY --from=abi /repo/build/Turncoat.json /app/build/Turncoat.json
COPY --from=deps /app/guard/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY levels ./levels
RUN mkdir -p data .secrets/commits && chown -R node:node data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npm", "start"]
