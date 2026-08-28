export const TRIVY_IMAGE = 'aquasec/trivy:0.73.0@sha256:7cced7cae583819fc7806d4cbc0dbbc7cad18b99f7d3e235192e6da8c091045c'
export const TRIVY_CACHE_VOLUME = 'homelab-inventory-trivy-cache:/root/.cache/'

export function trivyCommand(arguments_ = [], { dockerSocket = false } = {}) {
  return [
    'docker', 'run', '--rm',
    '--volume', TRIVY_CACHE_VOLUME,
    ...(dockerSocket ? ['--volume', '/var/run/docker.sock:/var/run/docker.sock'] : []),
    TRIVY_IMAGE,
    ...arguments_,
  ]
}

export async function refreshTrivyDatabase(run) {
  await run(trivyCommand(['clean', '--vuln-db']))
  await run(trivyCommand(['image', '--download-db-only']))
}

export async function ensureTrivyDatabase(run) {
  await run(trivyCommand(['image', '--download-db-only']))
}
