import fs from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dir, '..')
const pin = JSON.parse(await fs.readFile(path.join(root, 'server', 'agent-release-pin.json'), 'utf8'))
const dockerfile = await fs.readFile(path.join(root, 'Dockerfile'), 'utf8')
const source = path.join(root, 'vendor', 'homelab-inventory-agent')
const revision = (await Bun.$`git -C ${source} rev-parse HEAD`.quiet()).text().trim()
const changes = (await Bun.$`git -C ${source} status --porcelain`.quiet()).text().trim()

if (!/^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/.test(pin.version)) throw new Error('Pinned agent version is invalid.')
if (!/^[0-9a-f]{40}$/.test(pin.sourceRevision)) throw new Error('Pinned agent source revision is invalid.')
if (revision !== pin.sourceRevision) throw new Error(`Agent submodule ${revision} does not match pin ${pin.sourceRevision}.`)
if (changes) throw new Error('Agent submodule contains uncommitted changes. Commit them in the agent repository and update the pin first.')
if (pin.repository !== 'https://github.com/mriverodorta/homelab-inventory-agent') throw new Error('Pinned agent repository is invalid.')
if (!dockerfile.includes(`ARG AGENT_VERSION=${pin.version}`)) throw new Error('Dockerfile Agent version does not match the application pin.')
if (!dockerfile.includes(`ARG AGENT_SOURCE_REVISION=${pin.sourceRevision}`)) throw new Error('Dockerfile Agent source revision does not match the application pin.')

console.log(`Agent pin verified: ${pin.version} (${revision.slice(0, 7)}).`)
