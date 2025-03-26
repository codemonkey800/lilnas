FROM node AS base
ENV PNPM_VERSION="10.6.5"
COPY . /source
WORKDIR /source
RUN npm install -g pnpm@${PNPM_VERSION}
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM base AS apps
RUN pnpm build --filter=@lilnas/apps
RUN pnpm --filter=apps --prod deploy /app
RUN rm -rf /source

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=8080
EXPOSE 8080

WORKDIR /app
ENTRYPOINT ["pnpm", "start"]

FROM base AS dashcam-builder
RUN pnpm build --filter=@lilnas/dashcam

FROM nginx:alpine AS dashcam
COPY --from=dashcam-builder /source/packages/dashcam/dist /usr/share/nginx/html
COPY packages/dashcam/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80

FROM base AS equations
RUN pnpm build --filter=@lilnas/equations
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
RUN pnpm build --filter=@lilnas/me-token-tracker
RUN pnpm --filter=me-token-tracker --prod deploy /app
RUN rm -rf /source

EXPOSE 8080
WORKDIR /app
ENTRYPOINT ["pnpm", "start"]

FROM base AS tdr-bot
RUN pnpm build --filter=@lilnas/tdr-bot
RUN pnpm --filter=tdr-bot --prod deploy /app
RUN cp -r /source/packages/tdr-bot/public/ /app/.next/standalone/ && \
    rm -rf /source && \
    cp -r /app/.next/static/ /app/.next/standalone/.next/

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=8080
EXPOSE 8080

WORKDIR /app
ENTRYPOINT ["pnpm", "start"]

FROM base AS download
RUN pnpm build --filter=@lilnas/download
RUN pnpm --filter=download --prod deploy /app
RUN rm -rf /source && \
    cp -r /app/.next/static/ /app/.next/standalone/.next/

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

RUN curl \
        -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
        -o /usr/bin/yt-dlp && \
    chmod a+rx /usr/bin/yt-dlp

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=8080
EXPOSE 8080

WORKDIR /app
ENTRYPOINT ["pnpm", "start"]
