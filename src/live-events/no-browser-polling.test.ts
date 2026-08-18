import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function productionFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return productionFiles(filePath)
    if (!/\.[cm]?[jt]sx?$/.test(entry.name) || /(?:\.test|\.spec)\.[cm]?[jt]sx?$/.test(entry.name)) return []
    return [filePath]
  })
}

describe('browser live-data transport', () => {
  it('does not use query polling or interval-driven network requests', () => {
    const root = path.resolve(import.meta.dirname, '..')
    const violations = productionFiles(root).flatMap((filePath) => {
      const source = fs.readFileSync(filePath, 'utf8')
      const relative = path.relative(root, filePath)
      const found: string[] = []
      if (/\brefetchInterval\s*:/.test(source)) found.push(`${relative}: refetchInterval`)
      if (/setInterval\s*\([\s\S]{0,600}\b(?:fetch|refetch|invalidateQueries)\s*\(/.test(source)) {
        found.push(`${relative}: interval-driven network query`)
      }
      return found
    })

    expect(violations).toEqual([])
  })
})
