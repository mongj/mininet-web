# syntax=docker/dockerfile:1.12

# Build mininet from source
ARG TARGET_PLATFORM=linux/386
FROM --platform=$TARGET_PLATFORM alpine:3.21 AS builder
ARG MININET_VERSION=2.3.0
RUN apk add --no-cache \
    gcc~14.2 \
    musl-dev~1.2 \
    linux-headers~6.6 \
    curl~8.14
RUN curl -fL https://codeload.github.com/mininet/mininet/tar.gz/refs/tags/${MININET_VERSION} -o /tmp/mininet.tar.gz \
    && tar -xzf /tmp/mininet.tar.gz -C /tmp \
    && mv /tmp/mininet-* /src
RUN gcc -DVERSION=\"2.3.0\" -Wall -O2 /src/mnexec.c -o /mnexec

# Build guest rootfs and copy compiled mininet from builder
FROM --platform=$TARGET_PLATFORM alpine:3.21
RUN apk add --no-cache \
    linux-virt~6.12 \
    python3~3.12 \
    py3-setuptools~70.3 \
    bash~5.2 \
    iproute2~6.11 \
    iproute2-tc~6.11 \
    net-tools~2.10 \
    iputils~20240905 \
    procps-ng~4.0 \
    util-linux~2.40 \
    bridge-utils~1.7 \
    openvswitch~2.17 \
    tcpdump~4.99 \
    iperf3~3.17 \
    inetutils-telnet~2.5 \
    ethtool~6.11 \
    iptables~1.8 \
    iptables-legacy~1.8 \
    traceroute~2.1 \
    coreutils~9.5 \
    nano~8.2 \
    vim~9.1 \
    conntrack-tools~1.4 \
    curl~8.14 \
    bind-tools~9.18 \
    dnsmasq~2.90
# Mininet NAT shells out to `iptables -t nat`. Alpine's nft iptables needs
# nf_tables; the legacy binary matches Mininet and the xtables modules we keep.
RUN ln -sf iptables-legacy /usr/sbin/iptables \
    && ln -sf ip6tables-legacy /usr/sbin/ip6tables
# alpine:3.21 only ships iperf 2.2.0. Mininet 2.3.0 needs 2.0.13's server report.
RUN apk add --no-cache \
    --repository https://dl-cdn.alpinelinux.org/alpine/v3.12/main \
    iperf~2.0

COPY --from=builder /src/bin/mn /usr/bin/mn
COPY --from=builder /mnexec /usr/bin/mnexec
COPY --from=builder /src/mininet /usr/lib/python3.12/site-packages/mininet
COPY --from=builder /src/examples /usr/lib/python3.12/site-packages/mininet/examples
COPY --from=builder /src/LICENSE /usr/share/licenses/mininet/LICENSE

COPY init /init
COPY lab.py /usr/share/mininet-web/skel/lab.py
COPY trim-modules.sh /tmp/trim-modules.sh
RUN sh /tmp/trim-modules.sh && rm /tmp/trim-modules.sh
