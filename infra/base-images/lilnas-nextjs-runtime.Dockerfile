FROM lilnas-node-runtime AS nextjs
# Next.js specific runtime configuration
ENV NEXT_TELEMETRY_DISABLED=1

# Add OCI image source label
LABEL org.opencontainers.image.source=https://github.com/codemonkey800/lilnas
