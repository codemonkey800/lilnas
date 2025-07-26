FROM node:24.4.1-slim
ENV PNPM_VERSION="10.13.1"
RUN npm install -g pnpm@${PNPM_VERSION}

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas
