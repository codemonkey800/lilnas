FROM alpine:3.20

RUN apk add --no-cache docker-cli curl jq

COPY reaper.sh /usr/local/bin/reaper.sh
RUN chmod +x /usr/local/bin/reaper.sh

ENTRYPOINT ["/usr/local/bin/reaper.sh"]
