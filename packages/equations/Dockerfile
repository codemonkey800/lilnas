# Optimized Dockerfile using pre-built LaTeX image
FROM node:20-bullseye AS base

# Install pnpm
RUN npm install -g pnpm@10.6.5

# Build stage  
FROM base AS deps

WORKDIR /source

# Copy package files for dependency caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/equations/package.json packages/equations/
COPY packages/utils/package.json packages/utils/
COPY packages/eslint-config-lilnas/package.json packages/eslint-config-lilnas/
COPY packages/prettier-config-lilnas/package.json packages/prettier-config-lilnas/

# Install dependencies
RUN pnpm install

# Build stage
FROM deps AS build

# Copy source code
COPY . .

# Build the equations package and its dependencies
RUN pnpm build --filter=@lilnas/equations

# Deploy production build
RUN pnpm --filter=equations --prod deploy /app

# Production stage - use Node base and install LaTeX
FROM node:20-bullseye-slim AS production

# Install LaTeX packages
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        texlive-latex-base \
        texlive-latex-extra \
        texlive-latex-recommended \
        texlive-fonts-recommended \
        texlive-fonts-extra \
        texlive-lang-all \
        ghostscript \
        imagemagick \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm@10.6.5

# Create app user
RUN groupadd -r app && useradd -r -g app app

# Copy deployed application
COPY --from=build /app /app

# Copy ImageMagick policy (optional)
COPY --from=build /source/packages/equations/image-magick-policy.xml /etc/ImageMagick-6/policy.xml

# Set ownership
RUN chown -R app:app /app

# Switch to app user
USER app
WORKDIR /app

# Start the application
ENTRYPOINT ["pnpm", "start"]