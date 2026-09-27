# syntax=docker/dockerfile:1.12

# Build mininet from source
ARG TARGET_PLATFORM=linux/386
FROM --platform=$TARGET_PLATFORM alpine:3.21 AS builder
ARG MININET_VERSION=2.3.0
RUN apk add --no-cache \
    gcc=14.2.0-r4 \
    musl-dev=1.2.5-r11 \
    linux-headers=6.6-r1 \
    curl=8.14.1-r2
RUN curl -fL https://codeload.github.com/mininet/mininet/tar.gz/refs/tags/${MININET_VERSION} -o /tmp/mininet.tar.gz \
    && tar -xzf /tmp/mininet.tar.gz -C /tmp \
    && mv /tmp/mininet-* /src
RUN gcc -DVERSION=\"2.3.0\" -Wall -O2 /src/mnexec.c -o /mnexec

# Build guest rootfs and copy compiled mininet from builder
FROM --platform=$TARGET_PLATFORM alpine:3.21
RUN apk add --no-cache \
    linux-virt=6.12.111-r0 \
    python3=3.12.14-r0 \
    py3-setuptools=70.3.0-r0 \
    bash=5.2.37-r0 \
    iproute2=6.11.0-r0 \
    iproute2-tc=6.11.0-r0 \
    net-tools=2.10-r3 \
    iputils=20240905-r0 \
    procps-ng=4.0.4-r2 \
    util-linux=2.40.4-r1 \
    bridge-utils=1.7.1-r2 \
    openvswitch=2.17.11-r0 \
    tcpdump=4.99.5-r0 \
    iperf3=3.17.1-r0 \
    inetutils-telnet=2.5-r0 \
    coreutils=9.5-r2 \
    nano=8.2-r0 \
    vim=9.1.1105-r0
# alpine:3.21 only ships iperf 2.2.0. Mininet 2.3.0 needs 2.0.13's server report.
RUN apk add --no-cache \
    --repository https://dl-cdn.alpinelinux.org/alpine/v3.12/main \
    iperf=2.0.13-r2

COPY --from=builder /src/bin/mn /usr/bin/mn
COPY --from=builder /mnexec /usr/bin/mnexec
COPY --from=builder /src/mininet /usr/lib/python3.12/site-packages/mininet
COPY --from=builder /src/examples /usr/lib/python3.12/site-packages/mininet/examples
COPY --from=builder /src/LICENSE /usr/share/licenses/mininet/LICENSE

COPY init /init
COPY lab.py /root/lab.py
COPY trim-modules.sh /tmp/trim-modules.sh
RUN sh /tmp/trim-modules.sh && rm /tmp/trim-modules.sh
