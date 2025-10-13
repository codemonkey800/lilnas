FROM lilnas-node-base AS builder

# Install global build tools
RUN npm install -g turbo@^2.5.8

# Set up working directory
WORKDIR /source

# Install common build dependencies globally for faster builds
RUN npm install -g @swc/cli@0.7.8 @swc/core@1.13.5 typescript@5.9.3

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas
