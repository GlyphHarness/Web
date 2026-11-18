# syntax=docker/dockerfile:1
FROM alpine:3.20
RUN \
    apk add --no-cache bash coreutils git python3 github-cli curl ca-certificates jq
ENV PS1='\w $ '
CMD ["/bin/bash"]
