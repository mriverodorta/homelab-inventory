import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export function selectMonitorDigest(index, architecture) {
  if (!['amd64', 'arm64'].includes(architecture)) throw new Error('Unsupported monitor architecture.')
  if (!Array.isArray(index?.manifests)) throw new Error('Expected a multi-platform image index.')
  const matches = index.manifests.filter((entry) => entry.platform?.os === 'linux'
    && entry.platform?.architecture === architecture
    && (!entry.platform.variant || (architecture === 'arm64' && entry.platform.variant === 'v8'))
    && entry.annotations?.['vnd.docker.reference.type'] !== 'attestation-manifest')
  if (matches.length !== 1 || !/^sha256:[a-f0-9]{64}$/.test(matches[0].digest)) {
    throw new Error('Expected exactly one valid runtime manifest for the requested platform.')
  }
  return matches[0].digest
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [channel, architecture] = process.argv.slice(2)
  if (!['latest', 'stable'].includes(channel)) throw new Error('Unsupported monitor channel.')
  const repository = 'docker.io/mriverodorta/homelab-inventory'
  const index = JSON.parse(execFileSync('docker', ['buildx', 'imagetools', 'inspect', '--raw', `${repository}:${channel}`], { encoding: 'utf8', maxBuffer: 1024 * 1024 }))
  const reference = `${repository}@${selectMonitorDigest(index, architecture)}`
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `image-ref=${reference}\n`)
  console.log(reference)
}
