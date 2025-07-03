# Build stage
FROM lilnas-monorepo-builder AS build

# Build the equations package and its dependencies
RUN pnpm build --filter=@lilnas/equations

# Deploy production build
RUN pnpm --filter=equations --prod deploy /app

# Production stage
FROM lilnas-node-runtime AS production

# Install LaTeX packages and dependencies
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

# Copy deployed application
COPY --from=build /app /app

# Copy ImageMagick policy
COPY --from=build /source/packages/equations/image-magick-policy.xml /etc/ImageMagick-6/policy.xml

# Start the application
ENTRYPOINT ["pnpm", "start"]
