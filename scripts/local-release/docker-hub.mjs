import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const DOCKER_HUB_NAMESPACE = 'mriverodorta'
export const DOCKER_HUB_REPOSITORY = 'homelab-inventory'
export const DOCKER_HUB_REGISTRY_KEY = 'https://index.docker.io/v1/'

const DOCKER_HUB_API = 'https://hub.docker.com/v2'

export function candidateTagNames(tags) {
  return tags.filter((tag) => typeof tag === 'string' && tag.startsWith('candidate-'))
}

export function dockerCredentialHelper(config, registryKey = DOCKER_HUB_REGISTRY_KEY) {
  const helper = config?.credHelpers?.[registryKey] ?? config?.credsStore
  if (!helper) throw new Error('Docker Hub cleanup requires a configured Docker credential helper.')
  return `docker-credential-${helper}`
}

export function dockerHubTagUrl({ namespace = DOCKER_HUB_NAMESPACE, repository = DOCKER_HUB_REPOSITORY, tag }) {
  return `${DOCKER_HUB_API}/namespaces/${encodeURIComponent(namespace)}/repositories/${encodeURIComponent(repository)}/tags/${encodeURIComponent(tag)}`
}

function dockerHubTagsUrl({ namespace, repository }) {
  return `${DOCKER_HUB_API}/namespaces/${encodeURIComponent(namespace)}/repositories/${encodeURIComponent(repository)}/tags?page_size=100`
}

async function readDockerHubCredentials({ home = os.homedir(), spawn = Bun.spawn } = {}) {
  const config = JSON.parse(await fs.readFile(path.join(home, '.docker', 'config.json'), 'utf8'))
  const helper = dockerCredentialHelper(config)
  const child = spawn([helper, 'get'], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  })
  child.stdin.write(DOCKER_HUB_REGISTRY_KEY)
  child.stdin.end()
  const [exitCode, stdout] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
  ])
  if (exitCode !== 0) throw new Error('Docker Hub credential lookup failed.')
  const parsed = JSON.parse(stdout)
  if (!parsed.Username || !parsed.Secret) throw new Error('Docker Hub credentials are incomplete.')
  return { username: parsed.Username, secret: parsed.Secret }
}

async function expectJson(response, operation) {
  if (!response.ok) throw new Error(`${operation} failed with HTTP ${response.status}.`)
  try {
    return await response.json()
  } catch {
    throw new Error(`${operation} returned an invalid JSON response.`)
  }
}

async function createAccessToken({ fetchImpl, credentialsProvider }) {
  const credentials = await credentialsProvider()
  const response = await fetchImpl(`${DOCKER_HUB_API}/auth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: credentials.username, secret: credentials.secret }),
  })
  const payload = await expectJson(response, 'Docker Hub authentication')
  if (typeof payload.access_token !== 'string' || payload.access_token.length === 0) {
    throw new Error('Docker Hub authentication did not return an access token.')
  }
  return payload.access_token
}

async function listTags({ fetchImpl, token, namespace, repository }) {
  const tags = []
  let next = dockerHubTagsUrl({ namespace, repository })
  while (next) {
    const response = await fetchImpl(next, { headers: { authorization: `Bearer ${token}` } })
    const payload = await expectJson(response, 'Docker Hub tag listing')
    if (!Array.isArray(payload.results)) throw new Error('Docker Hub tag listing returned an invalid result set.')
    tags.push(...payload.results.map((entry) => entry?.name).filter((name) => typeof name === 'string'))
    next = typeof payload.next === 'string' && payload.next.length > 0 ? payload.next : null
  }
  return tags
}

async function deleteTag({ fetchImpl, token, namespace, repository, tag }) {
  const response = await fetchImpl(dockerHubTagUrl({ namespace, repository, tag }), {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  })
  if (response.status !== 204 && response.status !== 404) {
    throw new Error(`Docker Hub tag deletion for ${tag} failed with HTTP ${response.status}.`)
  }
}

export async function cleanupDockerHubCandidateTags({
  fetchImpl = fetch,
  credentialsProvider = readDockerHubCredentials,
  namespace = DOCKER_HUB_NAMESPACE,
  repository = DOCKER_HUB_REPOSITORY,
  tags = null,
} = {}) {
  const token = await createAccessToken({ fetchImpl, credentialsProvider })
  const existing = await listTags({ fetchImpl, token, namespace, repository })
  const requested = tags === null ? candidateTagNames(existing) : candidateTagNames(tags)
  const targets = requested.filter((tag) => existing.includes(tag))

  for (const tag of targets) {
    await deleteTag({ fetchImpl, token, namespace, repository, tag })
  }

  const remainingTags = await listTags({ fetchImpl, token, namespace, repository })
  const remaining = tags === null
    ? candidateTagNames(remainingTags)
    : requested.filter((tag) => remainingTags.includes(tag))
  if (remaining.length > 0) {
    throw new Error(`Candidate tags remain on Docker Hub: ${remaining.join(', ')}`)
  }
  return { deleted: targets, remaining }
}
