FROM golang:1.26.9-alpine@sha256:3082400e369fa24d5fc60bca20edab3f6d604e0c5a690ec66b295eff4dd87ade AS agent-build
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
