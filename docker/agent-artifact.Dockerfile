FROM golang:1.26.8-alpine@sha256:ce864e7223ac17b1775e6fd0b4c0db580c2eb50e7953a427916379e4b92a1628 AS agent-build
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
