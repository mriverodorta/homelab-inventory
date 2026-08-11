import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

async function files(directory: string): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await files(absolute))
    else if (entry.isFile()) result.push(absolute)
  }
  return result
}

export async function hashLegacyData(dataDir: string) {
  const selected = (await files(dataDir))
    .filter((filePath) => filePath.endsWith('.json'))
    .filter((filePath) => !filePath.includes('/backups/'))
    .filter((filePath) => !filePath.includes('/databases/'))
    .filter((filePath) => !filePath.includes('/.sqlite-migration/'))
    .sort()
  return Object.fromEntries(await Promise.all(selected.map(async (filePath) => [
    relative(dataDir, filePath),
    createHash('sha256').update(await readFile(filePath)).digest('hex'),
  ])))
}

export async function privateFileMode(filePath: string) {
  return (await stat(filePath)).mode & 0o777
}
