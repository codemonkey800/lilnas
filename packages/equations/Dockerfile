# Build stage
FROM lilnas-monorepo-builder AS deps

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/equations/package.json packages/equations/
COPY packages/utils/package.json packages/utils/
COPY packages/eslint-config-lilnas/package.json packages/eslint-config-lilnas/
COPY packages/prettier-config-lilnas/package.json packages/prettier-config-lilnas/

# Install dependencies (this layer gets cached)
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install

# Build stage
FROM deps AS build

# Copy source code (this layer changes frequently)
COPY . .

# Build the equations package and its dependencies
RUN pnpm build --filter=@lilnas/equations

# Deploy production build
RUN pnpm --filter=equations --prod deploy /app

# Production stage
FROM lilnas-node-runtime AS production

# Install LaTeX packages and dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ghostscript \
        imagemagick \
        texlive-fonts-extra \
        texlive-fonts-recommended \
        texlive-lang-all \
        texlive-latex-extra \
        texlive-latex-recommended \
    && rm -rf /var/lib/apt/lists/*

# Copy deployed application
COPY --from=build /app /app

# Copy ImageMagick policy
COPY --from=build /source/packages/equations/image-magick-policy.xml /etc/ImageMagick-6/policy.xml

# Start the application
ENTRYPOINT ["pnpm", "start"]
