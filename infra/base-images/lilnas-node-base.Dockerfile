FROM node:22-slim
ENV PNPM_VERSION="10.6.5"
RUN npm install -g pnpm@${PNPM_VERSION}

# Test Docker build workflow with base image change scenario
# This comment is added to trigger the workflow for testing

# Add OCI image source label
LABEL org.opencontainers.image.source https://github.com/codemonkey800/lilnas
