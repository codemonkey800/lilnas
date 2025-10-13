# Build stage
FROM node:24.10.0 AS dashcam-builder

ENV PNPM_VERSION="10.18.2"

# Copy the entire monorepo
COPY ../.. /source
WORKDIR /source

# Install pnpm
RUN npm install -g pnpm@${PNPM_VERSION}

# Install dependencies with cache mount
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# Build the dashcam package
RUN pnpm build --filter=@lilnas/dashcam

# Production stage
FROM nginx:alpine AS dashcam

# Copy built files from builder stage
COPY --from=dashcam-builder /source/packages/dashcam/dist /usr/share/nginx/html

# Copy nginx configuration
COPY packages/dashcam/nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas
