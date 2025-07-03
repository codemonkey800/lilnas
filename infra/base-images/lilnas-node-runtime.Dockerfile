FROM lilnas-node-base AS runtime
ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=8080
EXPOSE 8080
WORKDIR /app
