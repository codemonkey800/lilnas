# Multi-stage Dockerfile for @lilnas/swole

# Dependency caching stage
FROM lilnas-monorepo-builder AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/swole/package.json apps/swole/
COPY packages/cli/package.json packages/cli/
COPY packages/utils/package.json packages/utils/
COPY packages/eslint-config-lilnas/package.json packages/eslint-config-lilnas/
COPY packages/prettier-config-lilnas/package.json packages/prettier-config-lilnas/

# Install dependencies (this layer gets cached)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install

# Build stage
FROM deps AS builder

# Copy source code (this layer changes frequently)
COPY . .

# Build the swole package
RUN pnpm build --filter=@lilnas/swole

# Deploy production dependencies
RUN pnpm --filter=swole --prod deploy /app

# Copy the built Next.js application
RUN cp -r /source/apps/swole/.next /app/.next

# Turbopack (Next.js 16) emits hashed module IDs in the externals chunk, e.g.
# require("better-sqlite3-cf218e5bd1d5f04c") instead of require("better-sqlite3").
# This is a known Turbopack bug where serverExternalPackages doesn't fix the
# generated require string. Create a proxy package for each hashed ID so Node.js
# can resolve it at runtime.
RUN node -e "const fs=require('fs'),path=require('path'),chunksDir='/source/apps/swole/.next/server/chunks/',appMod='/app/node_modules/',files=fs.readdirSync(chunksDir).filter(f=>/^\[externals\]/.test(f)&&f.endsWith('.js')),seen=new Set();files.forEach(file=>{const src=fs.readFileSync(path.join(chunksDir,file),'utf8'),re=/require\(\"([^\"]+)\"\)/g;let m;while((m=re.exec(src))){const id=m[1];if(seen.has(id))continue;seen.add(id);const hm=id.match(/^(.+)-([0-9a-f]{16})$/);if(!hm)continue;const real=hm[1],dir=path.join(appMod,id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify({name:id,version:'0.0.1',main:'index.js'}));fs.writeFileSync(path.join(dir,'index.js'),'module.exports=require('+JSON.stringify(real)+');');console.log('turbopack-proxy:',id,'->',real);}});"

# Copy the standalone server to the correct location
RUN cp /source/apps/swole/.next/standalone/apps/swole/server.js /app/server.js

# Copy migrations into the standalone runtime so instrumentation.ts can apply
# them on boot. migrate.ts resolves the path via process.cwd() + src/db/migrations
# (WORKDIR below is /app), so the folder must live at /app/src/db/migrations.
# The MIGRATIONS_FOLDER env var is also honored as an override if needed.
RUN mkdir -p /app/src/db && \
    cp -r /source/apps/swole/src/db/migrations /app/src/db/migrations

# Copy public directory if it exists
RUN if [ -d /source/apps/swole/public ]; then \
      cp -r /source/apps/swole/public /app/.next/standalone/; \
    fi

# Copy static files to standalone directory
RUN if [ -d /app/.next/static ]; then \
      cp -r /app/.next/static /app/.next/standalone/.next/; \
    fi

# Verify the standalone server was copied correctly
RUN test -f /app/server.js || (echo "ERROR: Standalone server not found" && exit 1)

# Runtime stage
FROM lilnas-nextjs-runtime AS runtime

# Copy the built application with non-root ownership so the node user (UID 1000)
# can read/execute everything in /app at runtime.
COPY --from=builder --chown=node:node /app /app

WORKDIR /app

USER node

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas

ENTRYPOINT ["pnpm", "start"]
