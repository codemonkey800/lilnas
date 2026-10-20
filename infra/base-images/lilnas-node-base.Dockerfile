FROM node:26.12.0-slim
ENV PNPM_VERSION="12.14.0"
RUN npm install -g pnpm@${PNPM_VERSION}

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas
