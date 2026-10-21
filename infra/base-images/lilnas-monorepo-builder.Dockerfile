FROM ghcr.io/codemonkey800/lilnas-node-base:latest AS builder

# Install global build tools
RUN npm install -g turbo@2.11.10

# Set up working directory
WORKDIR /source

# Install common build dependencies globally for faster builds
RUN npm install -g @swc/cli@0.8.1 @swc/core@1.16.18 typescript@6.0.3

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas
