FROM node AS base
ENV PNPM_VERSION="10.6.5"
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

COPY . /source
WORKDIR /source
RUN npm install -g pnpm@${PNPM_VERSION}
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS apps
RUN pnpm --filter=apps build
RUN pnpm --filter=apps --prod deploy /app
RUN rm -rf /source

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=8080
EXPOSE 8080

WORKDIR /app
ENTRYPOINT ["pnpm", "start"]

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
RUN rm -rf /source

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
RUN rm -rf /source

EXPOSE 8080
WORKDIR /app
ENTRYPOINT ["pnpm", "start"]

FROM base AS tdr-bot
RUN pnpm --filter=tdr-bot build
RUN pnpm --filter=tdr-bot --prod deploy /app
RUN cp -r /source/packages/tdr-bot/public /app/public
RUN rm -rf /source

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=8080
EXPOSE 8080

WORKDIR /app
ENTRYPOINT ["pnpm", "start"]
