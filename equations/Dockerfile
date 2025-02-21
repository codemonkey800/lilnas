FROM node as base

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

RUN npm -g i pnpm

COPY . /app
WORKDIR /app

FROM base as prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --prod --frozen-lockfile

FROM base as build
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm build

FROM base

COPY --from=prod-deps /app/node_modules /app/node_modules
COPY --from=build /app/dist /app/dist
COPY ./image-magick-policy.xml /etc/ImageMagick-6/policy.xml

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
ENTRYPOINT ["pnpm", "start"]
