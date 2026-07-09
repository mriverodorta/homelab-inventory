#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-mriverodorta/homelab-inventory}"
PLATFORMS="${PLATFORMS:-linux/amd64}"
REQUESTED_VERSION=""

usage() {
  cat <<'EOF'
Usage:
  ./build.sh
  ./build.sh --ver 0.2.0

Options:
  --ver VERSION   Use an explicit semver version instead of bumping the patch version.
  -h, --help      Show this help text.

Environment:
  IMAGE_NAME      Docker image name. Default: mriverodorta/homelab-inventory
  PLATFORMS       Docker buildx platforms. Default: linux/amd64
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --ver)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --ver." >&2
        exit 1
      fi
      REQUESTED_VERSION="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

validate_semver() {
  local version="$1"

  if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Version must be semver in MAJOR.MINOR.PATCH format. Received: $version" >&2
    exit 1
  fi
}

read_package_version() {
  bun -e "const pkg = JSON.parse(await Bun.file('package.json').text()); console.log(pkg.version)"
}

bump_patch_version() {
  bun -e "const pkg = JSON.parse(await Bun.file('package.json').text()); const parts = pkg.version.split('.').map(Number); if (parts.length !== 3 || parts.some(Number.isNaN)) throw new Error('package.json version must be MAJOR.MINOR.PATCH'); console.log([parts[0], parts[1], parts[2] + 1].join('.'))"
}

write_package_version() {
  local version="$1"

  VERSION_TO_WRITE="$version" bun -e "const pkg = JSON.parse(await Bun.file('package.json').text()); pkg.version = process.env.VERSION_TO_WRITE; await Bun.write('package.json', JSON.stringify(pkg, null, 2) + '\n')"
}

require_command bun
require_command docker

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running or is not reachable." >&2
  exit 1
fi

if ! docker buildx version >/dev/null 2>&1; then
  echo "Docker buildx is required for publishing the image." >&2
  exit 1
fi

if [[ ! -f "${HOME}/.docker/config.json" ]] || ! grep -Eq '"auths"|"credsStore"|"credHelpers"' "${HOME}/.docker/config.json"; then
  echo "Docker credentials were not found. Run: docker login" >&2
  exit 1
fi

CURRENT_VERSION="$(read_package_version)"
validate_semver "$CURRENT_VERSION"

if [[ -n "$REQUESTED_VERSION" ]]; then
  NEXT_VERSION="$REQUESTED_VERSION"
else
  NEXT_VERSION="$(bump_patch_version)"
fi

validate_semver "$NEXT_VERSION"

if ! grep -Eq "version:[[:space:]]*['\"]${NEXT_VERSION//./\\.}['\"]" src/release-notes.ts; then
  echo "Missing release-note entry for ${NEXT_VERSION} in src/release-notes.ts." >&2
  echo "Add the entry before publishing, or use a version that already has release notes." >&2
  exit 1
fi

write_package_version "$NEXT_VERSION"

echo "Building ${IMAGE_NAME}:${NEXT_VERSION} and ${IMAGE_NAME}:latest"
echo "Platforms: ${PLATFORMS}"

docker buildx build \
  --platform "$PLATFORMS" \
  -t "${IMAGE_NAME}:${NEXT_VERSION}" \
  -t "${IMAGE_NAME}:latest" \
  --push \
  .

echo "Published:"
echo "  ${IMAGE_NAME}:${NEXT_VERSION}"
echo "  ${IMAGE_NAME}:latest"
