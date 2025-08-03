FROM ubuntu:latest

RUN apt-get update && \
    apt-get install -y wget lib32gcc-s1 && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    mkdir /l4d2

COPY infra/l4d2/run.sh /l4d2/run.sh

WORKDIR /l4d2

RUN chmod +x run.sh && \
    wget https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz && \
    tar -xzf steamcmd_linux.tar.gz && \
    rm -rf steamcmd_linux.tar.gz

ENTRYPOINT ["/l4d2/run.sh"]
