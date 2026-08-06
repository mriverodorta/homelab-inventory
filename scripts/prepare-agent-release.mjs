import fs from 'node:fs/promises'
import path from 'node:path'
import { AgentReleaseService } from '../server/agents/release-service.mjs'

const root = path.resolve(import.meta.dir, '..')
const pin = JSON.parse(await fs.readFile(path.join(root, 'server', 'agent-release-pin.json'), 'utf8'))
const source = path.join(root, 'vendor', 'homelab-inventory-agent')
const output = path.join(root, 'server', 'agent-release')

const revision = (await Bun.$`git -C ${source} rev-parse HEAD`.quiet()).text().trim()
if (revision !== pin.sourceRevision) {
  throw new Error(`Agent submodule is ${revision}; expected pinned revision ${pin.sourceRevision}.`)
}

let releaseReady = false
try {
  await new AgentReleaseService({
    directory: output,
    expectedVersion: pin.version,
    expectedSourceRevision: pin.sourceRevision,
  }).initialize()
  releaseReady = true
} catch {
  // Build the pinned release when no complete verified local bundle exists.
}

if (releaseReady) {
  console.log(`Reusing verified Homelab Inventory Agent ${pin.version} from ${pin.sourceRevision.slice(0, 7)}.`)
} else {
  await fs.mkdir(output, { recursive: true })
  await Bun.$`sh ${path.join(source, 'scripts', 'build-release.sh')} ${pin.version} ${output} ${pin.sourceRevision}`
  console.log(`Prepared Homelab Inventory Agent ${pin.version} from ${pin.sourceRevision.slice(0, 7)}.`)
}
