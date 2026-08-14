import fs from 'node:fs/promises'

export const GO_RELEASE_FEED = 'https://go.dev/dl/?mode=json&include=all'

const AGENT_BUILDER_PATTERN = /^FROM golang:(\d+)\.(\d+)\.(\d+)-alpine@sha256:([0-9a-f]{64}) AS agent-build$/m

export function parsePinnedGoToolchain(dockerfile) {
  const match = dockerfile.match(AGENT_BUILDER_PATTERN)
  if (!match) {
    throw new Error('Dockerfile must pin the agent builder as golang:X.Y.Z-alpine@sha256:<digest>.')
  }
  return {
    version: `${match[1]}.${match[2]}.${match[3]}`,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    digest: `sha256:${match[4]}`,
  }
}

function parseReleaseVersion(value) {
  const match = /^go(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) return null
  return { version: `${match[1]}.${match[2]}.${match[3]}`, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

export function latestStablePatch(releases, { major, minor }) {
  if (!Array.isArray(releases)) throw new Error('The official Go release feed did not return an array.')
  const matching = releases
    .filter((release) => release?.stable === true)
    .map((release) => parseReleaseVersion(release.version))
    .filter((release) => release?.major === major && release.minor === minor)
    .sort((left, right) => right.patch - left.patch)
  if (!matching[0]) throw new Error(`The official Go release feed has no stable ${major}.${minor}.x release.`)
  return matching[0]
}

export function assertCurrentGoToolchain({ dockerfile, releases }) {
  const pinned = parsePinnedGoToolchain(dockerfile)
  const latest = latestStablePatch(releases, pinned)
  if (pinned.patch < latest.patch) {
    throw new Error(`The agent builder uses Go ${pinned.version}, but Go ${latest.version} is the latest stable ${pinned.major}.${pinned.minor}.x security patch.`)
  }
  if (pinned.patch > latest.patch) {
    throw new Error(`The agent builder uses unrecognized Go ${pinned.version}; the official feed reports ${latest.version}.`)
  }
  return { pinned, latest }
}

export async function verifyCurrentGoToolchain({ dockerfileUrl = new URL('../../Dockerfile', import.meta.url), fetchImpl = fetch } = {}) {
  const [dockerfile, response] = await Promise.all([
    fs.readFile(dockerfileUrl, 'utf8'),
    fetchImpl(GO_RELEASE_FEED, { headers: { accept: 'application/json' } }),
  ])
  if (!response.ok) throw new Error(`Unable to verify the Go security patch level: official release feed returned HTTP ${response.status}.`)
  const result = assertCurrentGoToolchain({ dockerfile, releases: await response.json() })
  console.log(`Verified agent builder Go ${result.pinned.version} is the latest stable ${result.pinned.major}.${result.pinned.minor}.x patch.`)
  return result
}
