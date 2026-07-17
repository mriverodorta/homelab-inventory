import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_COPY = 'COPY --chown=10001:10001 server/index.mjs server/agent-routes.mjs ./server/'
const EXTENDED_SERVER_COPY = 'COPY --chown=10001:10001 server/index.mjs server/agent-routes.mjs server/update-checker.mjs server/update-routes.mjs server/update-scheduler.mjs ./server/'

const REPAIRS = new Map([
  ['0.1.11', {
    importPath: '../src/release-notes.ts',
    sourceFile: 'src/release-notes.ts',
    copyInstruction: 'COPY --chown=10001:10001 src/release-notes.ts ./src/release-notes.ts',
    anchor: SERVER_COPY,
    reason: 'release-notes-copy-added',
  }],
  ['0.1.18', {
    importPath: './rate-limit.mjs',
    sourceFile: 'server/rate-limit.mjs',
    copyInstruction: 'COPY --chown=10001:10001 server/rate-limit.mjs ./server/rate-limit.mjs',
    anchor: EXTENDED_SERVER_COPY,
    reason: 'rate-limit-copy-added',
  }],
])

export async function prepareHistoricalRuntime({ sourceDir, version }) {
  const repair = REPAIRS.get(version)
  if (!repair) {
    return { repaired: false, reason: 'version-not-affected' }
  }

  const dockerfilePath = path.join(sourceDir, 'Dockerfile')
  const serverPath = path.join(sourceDir, 'server', 'index.mjs')
  const [dockerfile, serverSource] = await Promise.all([
    fs.readFile(dockerfilePath, 'utf8'),
    fs.readFile(serverPath, 'utf8'),
  ])

  if (!serverSource.includes(repair.importPath)) {
    throw new Error(`${version} no longer matches the expected ${repair.sourceFile} import defect.`)
  }

  await fs.access(path.join(sourceDir, repair.sourceFile))

  if (dockerfile.includes(repair.copyInstruction)) {
    return { repaired: false, reason: 'already-repaired' }
  }

  const anchorIndex = dockerfile.indexOf(repair.anchor)
  if (anchorIndex === -1 || dockerfile.indexOf(repair.anchor, anchorIndex + 1) !== -1) {
    throw new Error(`${version} Dockerfile does not contain exactly one expected server COPY instruction.`)
  }

  const repairedDockerfile = dockerfile.replace(repair.anchor, `${repair.anchor}\n${repair.copyInstruction}`)
  await fs.writeFile(dockerfilePath, repairedDockerfile)

  return { repaired: true, reason: repair.reason }
}

function parseArguments(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!flag?.startsWith('--') || value === undefined) {
      throw new Error('Usage: prepare-historical-runtime.mjs --source-dir <path> --version <version>')
    }
    values.set(flag, value)
  }

  const sourceDir = values.get('--source-dir')
  const version = values.get('--version')
  if (!sourceDir || !version) {
    throw new Error('Usage: prepare-historical-runtime.mjs --source-dir <path> --version <version>')
  }

  return { sourceDir: path.resolve(sourceDir), version }
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isCli) {
  try {
    const result = await prepareHistoricalRuntime(parseArguments(process.argv.slice(2)))
    console.log(JSON.stringify(result))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Unable to prepare historical runtime packaging.')
    process.exitCode = 1
  }
}
