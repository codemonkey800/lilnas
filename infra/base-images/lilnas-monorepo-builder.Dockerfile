FROM lilnas-node-base AS builder
COPY . /source
WORKDIR /source
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
