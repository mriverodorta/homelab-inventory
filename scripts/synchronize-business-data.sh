#!/usr/bin/env bash

set -Eeuo pipefail

source_data_dir="$1"
destination_data_dir="$2"
output_data_dir="$3"

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

[[ -d "${source_data_dir}" ]] || fail "source data directory is missing."
[[ -f "${source_data_dir}/stores/inventory.json" ]] || fail "source inventory store is missing."
[[ -f "${source_data_dir}/stores/project.json" ]] || fail "source project store is missing."
command -v jq >/dev/null 2>&1 || fail "jq is required."

rm -rf -- "${output_data_dir}"
mkdir -p -- "${output_data_dir}"
if [[ -d "${destination_data_dir}" ]]; then
  cp -a -- "${destination_data_dir}/." "${output_data_dir}/"
fi
mkdir -p -- "${output_data_dir}/stores"

for name in inventory.json project.json; do
  if [[ -f "${source_data_dir}/stores/${name}" ]]; then
    cp -- "${source_data_dir}/stores/${name}" "${output_data_dir}/stores/${name}"
  fi
done

if [[ -f "${source_data_dir}/stores/registry.json" ]]; then
  destination_identity='null'
  if [[ -f "${destination_data_dir}/stores/registry.json" ]]; then
    destination_identity="$(jq -c '.installationIdentity // null' "${destination_data_dir}/stores/registry.json")"
  fi
  jq --argjson installationIdentity "${destination_identity}" \
    '.installationIdentity = $installationIdentity' \
    "${source_data_dir}/stores/registry.json" \
    > "${output_data_dir}/stores/registry.json"
fi

for name in inventory.json project.json registry.json; do
  file="${output_data_dir}/stores/${name}"
  if [[ -f "${file}" ]]; then
    jq -e 'type == "object"' "${file}" >/dev/null || fail "synchronized stores/${name} is invalid."
  fi
done
