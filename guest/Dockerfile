FROM --platform=linux/386 alpine:3.21 AS builder
RUN apk add --no-cache gcc musl-dev linux-headers curl
ARG MININET_VERSION=2.3.0
RUN curl -fL https://codeload.github.com/mininet/mininet/tar.gz/refs/tags/${MININET_VERSION} -o /tmp/mininet.tar.gz && tar -xzf /tmp/mininet.tar.gz -C /tmp && mv /tmp/mininet-* /src
RUN gcc -DVERSION=\"2.3.0\" -Wall -O2 /src/mnexec.c -o /mnexec
FROM --platform=linux/386 alpine:3.21
RUN apk add --no-cache linux-virt python3 py3-setuptools bash iproute2 iproute2-tc net-tools iputils procps util-linux bridge-utils openvswitch tcpdump iperf3 coreutils nano vim
COPY --from=builder /src/mininet /usr/lib/python3.12/site-packages/mininet
# mn imports mininet.examples.cluster unconditionally; examples live at the repo root.
COPY --from=builder /src/examples /usr/lib/python3.12/site-packages/mininet/examples
COPY --from=builder /src/bin/mn /usr/bin/mn
COPY --from=builder /mnexec /usr/bin/mnexec
COPY --from=builder /src/LICENSE /usr/share/licenses/mininet/LICENSE
COPY init /init
COPY lab.py /root/lab.py
# Keep vim syntax/ftplugin/runtime so vimrc and defaults.vim start without E484.
# Omit only bulky extras (help, tutor, spell, translations, macros).
RUN chmod +x /init /usr/bin/mn && mkdir -p /dev/pts /proc /sys /run/openvswitch /var/run/openvswitch /tmp /root && rm -rf /usr/lib/python3.12/test /usr/lib/python3.12/ensurepip /usr/share/man /usr/share/doc /var/cache/apk/* /usr/share/nano /usr/share/vim/*/doc /usr/share/vim/*/tutor /usr/share/vim/*/lang /usr/share/vim/*/spell /usr/share/vim/*/macros /usr/share/vim/*/tools /usr/share/vim/*/print
COPY trim-modules.sh /tmp/trim-modules.sh
RUN sh /tmp/trim-modules.sh && rm /tmp/trim-modules.sh
