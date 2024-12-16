FROM node:alpine

WORKDIR /app
COPY . .

RUN apk add --no-cache libc6-compat tree
RUN corepack enable pnpm && pnpm i --frozen-lockfile
RUN cd packages/apps && tree . && pnpm build
RUN pnpm prune --prod

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["pnpm", "start"]
