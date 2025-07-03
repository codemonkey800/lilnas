FROM node:22-slim
ENV PNPM_VERSION="10.6.5"
RUN npm install -g pnpm@${PNPM_VERSION}
