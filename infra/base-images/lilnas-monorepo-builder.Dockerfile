FROM ghcr.io/codemonkey800/lilnas-node-base:latest AS builder

# Install global build tools
RUN npm install -g turbo@^2.4.4

# Set up working directory
WORKDIR /source

# Install common build dependencies globally for faster builds
RUN npm install -g @swc/cli@0.6.0 @swc/core@1.11.12 typescript@5.8.2

# Add OCI image source label
LABEL org.opencontainers.image.source https://github.com/codemonkey800/lilnas
