FROM golang:1.26.10-alpine@sha256:27f2d3b83cfc5803c8078f8e730af0f7c431bf067afaec8f60a36fb763187cba AS agent-build
WORKDIR /agent
ARG AGENT_VERSION=0.3.4
ARG AGENT_SOURCE_REVISION=c216bad09aaaea9bb0588cb0a7ebde29b5fd9cb6
COPY server/agent-release-pin.json /agent-release-pin.json
COPY vendor/homelab-inventory-agent ./
RUN grep -Fq "\"version\": \"${AGENT_VERSION}\"" /agent-release-pin.json \
  && grep -Fq "\"sourceRevision\": \"${AGENT_SOURCE_REVISION}\"" /agent-release-pin.json \
  && sh scripts/build-release.sh "${AGENT_VERSION}" /agent-release "${AGENT_SOURCE_REVISION}"

FROM scratch
COPY --from=agent-build /agent-release /
