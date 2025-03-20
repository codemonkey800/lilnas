FROM node AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

COPY . /source
WORKDIR /source
RUN npm install -g pnpm
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS apps
RUN pnpm --filter=apps build
RUN pnpm --filter=apps --prod deploy /app

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=8080
EXPOSE 8080

WORKDIR /app
RUN cp -r /app/.next/standalone/* /app
CMD ["node", "server.js"]

FROM base AS dashcam-builder
RUN pnpm --filter=dashcam build

FROM nginx:alpine AS dashcam
COPY --from=dashcam-builder /source/packages/dashcam/dist /usr/share/nginx/html
COPY packages/dashcam/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

FROM base AS equations
RUN pnpm --filter=equations build
RUN pnpm --filter=equations --prod deploy /app
COPY packages/equations/image-magick-policy.xml /etc/ImageMagick-6/policy.xml

# Latex packages
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ghostscript \
        imagemagick \
        texlive-fonts-extra \
        texlive-fonts-recommended \
        texlive-lang-all \
        texlive-latex-extra \
        texlive-latex-recommended \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 8080
WORKDIR /app
ENTRYPOINT ["pnpm", "start"]

FROM base AS me-token-tracker
RUN pnpm --filter=me-token-tracker build
RUN pnpm --filter=me-token-tracker --prod deploy /app

EXPOSE 8080
WORKDIR /app
ENTRYPOINT ["pnpm", "start"]

FROM base AS tdr-bot
RUN pnpm --filter=tdr-bot build
RUN pnpm --filter=tdr-bot --prod deploy /app

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=8080
EXPOSE 8080

WORKDIR /app
RUN cp -r /app/.next/standalone/* /app
CMD ["pnpm", "start"]
